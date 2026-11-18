#!/usr/bin/env python3
"""
migrate_to_antigravity.py — Scaffold/validate Antigravity configuration from a
Hyperagent project layout.

Maps Hyperagent artifacts to Antigravity conventions:

  Hyperagent artifact          ->  Antigravity destination
  ---------------------------------------------------------------
  named agent (agent.yaml /    ->  .agents/agents/<name>.md
    agents/<name>.yaml/md)         (subagent Markdown + YAML frontmatter)
  skill (skills/<name>/...)    ->  .agents/skills/<name>/SKILL.md
  memory (memories/*.md)       ->  AGENTS.md rules section (always-in-context)
  rubric (rubrics/*.md|yaml)   ->  .agents/skills/<name>/SKILL.md (evaluation skill)
  table (tables/*.csv|json)    ->  .agents/skills/<name>/resources/<table>
  state document (state/*.md)  ->  .agents/rules/<name>.md (conditional rules)
  MCP config                   ->  .agents/mcp_config.json (mcpServers key;
                                   legacy url/httpUrl rewritten to serverUrl)

Usage:
  migrate_to_antigravity.py --source /path/to/hyperagent-project [--dest /path/to/repo] [--dry-run]
  migrate_to_antigravity.py --validate /path/to/repo

Exit codes: 0 = ok, 1 = validation failed / bad input.
"""
import argparse
import csv
import io
import json
import os
import re
import shutil
import sys

KEBAB_RE = re.compile(r"[^a-z0-9]+")

WS_AGENTS_DIR = ".agents"
WS_AGENTS_SUBDIR = os.path.join(WS_AGENTS_DIR, "agents")
WS_SKILLS_SUBDIR = os.path.join(WS_AGENTS_DIR, "skills")
WS_RULES_SUBDIR = os.path.join(WS_AGENTS_DIR, "rules")
WS_MCP_CONFIG = os.path.join(WS_AGENTS_DIR, "mcp_config.json")
AGENTS_MD = "AGENTS.md"


def kebab(name: str) -> str:
    s = name.strip().lower()
    s = KEBAB_RE.sub("-", s).strip("-")
    return s or "unnamed"


def find_files(root, subdirs, exts):
    """Yield file paths under root/<subdirs>/*.ext (any nesting)."""
    for d in subdirs:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in sorted(filenames):
                if os.path.splitext(fn)[1].lower() in exts:
                    yield os.path.join(dirpath, fn)


def parse_nested_yaml(text):
    """Minimal YAML parser for two-level structures: scalar keys plus
    one-level-nested lists/dicts. Sufficient for Hyperagent rubric files."""
    root = {}
    current_key = None
    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_ -]*)\s*:\s*(.*)$", line)
        if indent == 0 and m:
            key, val = m.group(1).strip(), m.group(2).strip()
            if val:
                root[key] = val.strip('"\'')
                current_key = None
            else:
                root[key] = {}
                current_key = key
        elif current_key is not None:
            if line.startswith("- "):
                root[current_key] = root[current_key] if isinstance(root[current_key], list) else []
                if isinstance(root[current_key], list):
                    root[current_key].append(line[2:].strip())
            elif isinstance(root[current_key], dict) and ":" in line:
                k, _, v = line.partition(":")
                root[current_key][k.strip()] = v.strip().strip('"\'')
    return root


def parse_simple_yaml_kv(text):
    """Extract top-level `key: value` pairs from simple YAML frontmatter/body."""
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$", line)
        if m and not line.startswith((" ", "-", "#")):
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def infer_model(ha_agent):
    """Map a Hyperagent agent's model hint to an Antigravity model tier."""
    raw = str(ha_agent.get("model", "")).lower()
    if "opus" in raw or "large" in raw or "max" in raw:
        return "pro"
    if "flash" in raw or "small" in raw or "fast" in raw:
        return "flash"
    return "pro"  # conservative default for autonomous work


def convert_agent(src_path, dest_dir):
    """Convert one Hyperagent named agent to an Antigravity subagent .md file."""
    with open(src_path, "r", encoding="utf-8") as f:
        text = f.read()
    if src_path.endswith((".yaml", ".yml", ".json")):
        try:
            if src_path.endswith(".json"):
                data = json.loads(text)
            else:
                data = parse_simple_yaml_kv(text)
        except (ValueError, json.JSONDecodeError):
            data = {}
    else:
        data = parse_simple_yaml_kv(text)

    name = kebab(data.get("name") or os.path.splitext(os.path.basename(src_path))[0])
    description = data.get("description") or data.get("role") or (
        "Migrated Hyperagent agent %s. Use when its responsibilities apply." % name
    )
    model = infer_model(data)
    body = data.get("system_prompt") or data.get("prompt") or data.get("instructions") or ""
    if not body:
        # For .md sources, everything after frontmatter is the prompt.
        if text.startswith("---"):
            parts = text.split("---", 2)
            body = parts[2].strip() if len(parts) > 2 else ""
        else:
            body = text.strip()

    # Strip Hyperagent-only keys from the prompt body so they don't confuse
    # the target agent.
    body = re.sub(r"^memories\s*:.*$", "", body, flags=re.MULTILINE | re.IGNORECASE)

    tools = data.get("tools") or ""
    tools_line = "tools: [%s]" % tools if tools else ""
    lines = ["---", "name: %s" % name, "description: >-",
             "  " + " ".join(str(description).split()), "subagent: true"]
    if tools_line:
        lines.append(tools_line)
    lines += ["model: %s" % model, "commandExecutionPolicy: sandbox", "---", "", body.strip(), ""]
    dest = os.path.join(dest_dir, name + ".md")
    return dest, "\n".join(lines)


def yaml_to_md(value, indent=0):
    """Render parsed simple YAML (dicts/lists/scalars) as readable markdown."""
    pad = "  " * indent
    lines = []
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                lines.append("%s- **%s**" % (pad, k))
                lines.append(yaml_to_md(v, indent + 1))
            else:
                lines.append("%s- **%s**: %s" % (pad, k, v))
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(yaml_to_md(item, indent))
            else:
                lines.append("%s- %s" % (pad, item))
    else:
        lines.append("%s%s" % (pad, value))
    return "\n".join(l for l in lines if l.strip())


def convert_skill(src_path, dest_dir):
    """Convert a Hyperagent skill or rubric into an Antigravity SKILL.md."""
    with open(src_path, "r", encoding="utf-8") as f:
        text = f.read()
    if src_path.endswith((".yaml", ".yml")):
        data = parse_nested_yaml(text)
        name = kebab(data.get("name") or os.path.splitext(os.path.basename(src_path))[0])
        summary = data.get("description") or "Migrated Hyperagent artifact %s." % name
        body_keys = {k: v for k, v in data.items() if k not in ("name", "description")}
        body = yaml_to_md(body_keys) if body_keys else text.strip()
    else:
        name = kebab(os.path.splitext(os.path.basename(src_path))[0])
        m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        if m:
            name = kebab(m.group(1))
        first_para = re.search(r"\n\n(.+?)(?:\n\n|\Z)", text, re.DOTALL)
        summary = " ".join(first_para.group(1).split())[:280] if first_para else (
            "Migrated Hyperagent skill %s." % name
        )
        body = text
        # Strip any existing frontmatter so we can write our own.
        if body.startswith("---"):
            parts = body.split("---", 2)
            body = parts[2] if len(parts) > 2 else body
    skill_md = (
        "---\nname: {name}\n"
        "description: >-\n  {desc}\n"
        "  Use when: the migrated Hyperagent workflow \"{name}\" applies.\n"
        "---\n\n# {title}\n\n{body}\n"
    ).format(name=name, desc=" ".join(str(summary).split()),
             title=name.replace("-", " ").title(), body=body.strip())
    dest = os.path.join(dest_dir, name, "SKILL.md")
    return dest, skill_md


def migrate(source, dest, dry_run=False):
    """Scaffold Antigravity config from a Hyperagent project. Returns report dict."""
    report = {"created": [], "skipped": [], "warnings": []}
    if not os.path.isdir(source):
        report["warnings"].append("source is not a directory: %s" % source)
        return report

    def write(path, content):
        rel = os.path.relpath(path, dest)
        if os.path.exists(path):
            report["skipped"].append(rel)
            return
        report["created"].append(rel)
        if dry_run:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    # 1. Named agents -> .agents/agents/<name>.md
    agent_files = list(find_files(source, ["agents", "agent"], [".yaml", ".yml", ".json", ".md"]))
    for src in agent_files:
        dest_path, content = convert_agent(src, os.path.join(dest, WS_AGENTS_SUBDIR))
        write(dest_path, content)

    # 2. Skills -> .agents/skills/<name>/SKILL.md
    skill_files = list(find_files(source, ["skills", "skill"], [".md"]))
    for src in skill_files:
        dest_path, content = convert_skill(src, os.path.join(dest, WS_SKILLS_SUBDIR))
        write(dest_path, content)

    # 3. Memories -> AGENTS.md rules section (always in context)
    memory_files = list(find_files(source, ["memories", "memory"], [".md", ".txt"]))
    if memory_files:
        sections = []
        for src in memory_files:
            with open(src, "r", encoding="utf-8") as f:
                sections.append("## Memory: %s\n\n%s" % (
                    os.path.splitext(os.path.basename(src))[0].replace("-", " ").title(),
                    f.read().strip()))
        agents_md_path = os.path.join(dest, AGENTS_MD)
        header = ("# Project Rules (migrated from Hyperagent memories)\n\n"
                  "These rules are always in context. Keep this file under the\n"
                  "20,000-token shared budget for user + workspace rules.\n\n")
        if os.path.exists(agents_md_path):
            with open(agents_md_path, "r", encoding="utf-8") as f:
                existing = f.read()
            if "migrated from Hyperagent memories" in existing:
                report["skipped"].append(AGENTS_MD)
            else:
                report["warnings"].append(
                    "AGENTS.md exists; append memory sections manually to avoid clobbering.")
        else:
            write(agents_md_path, header + "\n".join(sections) + "\n")

    # 4. Rubrics -> evaluation skills
    for src in find_files(source, ["rubrics", "rubric"], [".md", ".yaml", ".yml", ".json"]):
        dest_path, content = convert_skill(src, os.path.join(dest, WS_SKILLS_SUBDIR))
        # Annotate as an evaluation skill.
        content = content.replace("Use when:", "Use when: evaluating or grading output against this rubric,", 1)
        write(dest_path, content)

    # 5. Tables -> skill resources
    table_files = list(find_files(source, ["tables", "table"], [".csv", ".json", ".tsv"]))
    if table_files:
        # Bundle tables into a single lookup skill's resources directory.
        res_dir = os.path.join(dest, WS_SKILLS_SUBDIR, "reference-tables", "resources")
        for src in table_files:
            dest_path = os.path.join(res_dir, os.path.basename(src))
            write(dest_path, open(src, "r", encoding="utf-8").read())
        # Generate an index SKILL.md if it doesn't already exist.
        skill_md = os.path.join(dest, WS_SKILLS_SUBDIR, "reference-tables", "SKILL.md")
        if not os.path.exists(skill_md) or dry_run:
            listing = "\n".join("- resources/%s" % os.path.basename(p) for p in table_files)
            write(skill_md,
                  "---\nname: reference-tables\n"
                  "description: >-\n  Lookup tables migrated from Hyperagent (CSV/JSON/TSV).\n"
                  "  Use when: a task needs exact reference data from the bundled resources.\n"
                  "---\n\n# Reference Tables\n\n%s\n" % listing)
        else:
            report["skipped"].append(os.path.relpath(skill_md, dest))

    # 6. State documents -> .agents/rules/*.md
    for src in find_files(source, ["state", "state_documents", "state-docs"], [".md"]):
        dest_path = os.path.join(dest, WS_RULES_SUBDIR, os.path.basename(src))
        write(dest_path, open(src, "r", encoding="utf-8").read())

    # 7. MCP config -> .agents/mcp_config.json
    return _migrate_mcp(source, dest, report, write)


def _migrate_mcp(source, dest, report, write):
    candidates = [
        os.path.join(source, "mcp_config.json"),
        os.path.join(source, ".mcp.json"),
        os.path.join(source, ".agents", "mcp_config.json"),
        os.path.join(source, ".gemini", "settings.json"),
    ]
    src_cfg = next((c for c in candidates if os.path.exists(c)), None)
    dest_cfg = os.path.join(dest, WS_MCP_CONFIG)
    if src_cfg is None:
        # Nothing to migrate; ensure a valid empty config exists.
        if not os.path.exists(dest_cfg):
            write(dest_cfg, json.dumps({"mcpServers": {}}, indent=2) + "\n")
        else:
            report["skipped"].append(WS_MCP_CONFIG)
        return report

    try:
        with open(src_cfg, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except ValueError as e:
        report["warnings"].append("could not parse %s: %s" % (src_cfg, e))
        return report
    servers = raw.get("mcpServers", raw if isinstance(raw, dict) else {})
    migrated = {}
    for name, cfg in servers.items():
        if not isinstance(cfg, dict):
            continue
        cfg = dict(cfg)
        # Gemini CLI legacy keys -> Antigravity serverUrl
        for legacy in ("url", "httpUrl"):
            if legacy in cfg:
                cfg["serverUrl"] = cfg.pop(legacy)
        migrated[name] = cfg
    if os.path.exists(dest_cfg):
        report["skipped"].append(WS_MCP_CONFIG + " (exists; merge servers manually)")
    else:
        write(dest_cfg, json.dumps({"mcpServers": migrated}, indent=2) + "\n")
    return report


def validate(repo):
    """Check that a repo's Antigravity config is well-formed. Returns (ok, issues)."""
    issues = []
    agents_dir = os.path.join(repo, WS_AGENTS_SUBDIR)
    skills_dir = os.path.join(repo, WS_SKILLS_SUBDIR)
    mcp_path = os.path.join(repo, WS_MCP_CONFIG)

    if not os.path.isdir(agents_dir):
        issues.append("missing %s" % WS_AGENTS_SUBDIR)

    if os.path.isdir(agents_dir):
        for fn in sorted(os.listdir(agents_dir)):
            if not fn.endswith(".md"):
                continue
            path = os.path.join(agents_dir, fn)
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            if not text.lstrip().startswith("---"):
                issues.append("%s: subagent file missing YAML frontmatter" % fn)
                continue
            front = parse_simple_yaml_kv(text.split("---")[1])
            if "subagent: true" not in text and front.get("subagent") != "true":
                issues.append("%s: frontmatter missing 'subagent: true'" % fn)
            if not front.get("description"):
                issues.append("%s: frontmatter missing 'description'" % fn)

    if os.path.isdir(skills_dir):
        for name in sorted(os.listdir(skills_dir)):
            skill_md = os.path.join(skills_dir, name, "SKILL.md")
            if not os.path.exists(skill_md):
                issues.append(".agents/skills/%s: no SKILL.md" % name)
                continue
            with open(skill_md, "r", encoding="utf-8") as f:
                text = f.read()
            if not text.lstrip().startswith("---"):
                issues.append(".agents/skills/%s/SKILL.md: missing frontmatter" % name)
                continue
            front = parse_simple_yaml_kv(text.split("---")[1])
            if not front.get("name"):
                issues.append(".agents/skills/%s/SKILL.md: frontmatter missing 'name'" % name)
            if not front.get("description"):
                issues.append(".agents/skills/%s/SKILL.md: frontmatter missing 'description'" % name)

    if os.path.exists(mcp_path):
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            servers = cfg.get("mcpServers")
            if servers is None:
                issues.append("%s: missing top-level 'mcpServers' key" % WS_MCP_CONFIG)
            else:
                for name, s in servers.items():
                    if not isinstance(s, dict) or ("command" not in s and "serverUrl" not in s):
                        issues.append("%s: server '%s' needs 'command' or 'serverUrl'" % (WS_MCP_CONFIG, name))
                    for legacy in ("url", "httpUrl"):
                        if isinstance(s, dict) and legacy in s:
                            issues.append("%s: server '%s' uses legacy '%s'; rename to 'serverUrl'"
                                          % (WS_MCP_CONFIG, name, legacy))
        except ValueError as e:
            issues.append("%s: invalid JSON (%s)" % (WS_MCP_CONFIG, e))
    else:
        issues.append("missing %s" % WS_MCP_CONFIG)

    if os.path.exists(os.path.join(repo, ".gemini", "skills")):
        issues.append("legacy .gemini/skills/ found; move to .agents/skills/")
    return (len(issues) == 0), issues


def main():
    ap = argparse.ArgumentParser(description="Migrate a Hyperagent project to Google Antigravity.")
    ap.add_argument("--source", help="Hyperagent project root")
    ap.add_argument("--dest", help="Target repo root (default: --source)")
    ap.add_argument("--dry-run", action="store_true", help="Report without writing files")
    ap.add_argument("--validate", metavar="REPO", help="Validate Antigravity config in REPO")
    args = ap.parse_args()

    if args.validate:
        ok, issues = validate(args.validate)
        print(json.dumps({"ok": ok, "issues": issues}, indent=2))
        sys.exit(0 if ok else 1)

    if not args.source:
        ap.error("provide --source or --validate")

    report = migrate(args.source, args.dest or args.source, args.dry_run)
    print(json.dumps(report, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()