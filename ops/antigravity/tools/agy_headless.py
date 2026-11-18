#!/usr/bin/env python3
"""
agy_headless.py — Run a Google Antigravity CLI (agy) autonomous loop headlessly
and report a normalized, machine-checkable result.

Wraps:  agy -p "<prompt>" --output-format json [flags]

What it checks for you (the things that silently break long autonomous runs):
  * finished_reason — a JSON/stream-JSON result is only complete if it is a
    normal finish. 'print_timeout', 'interrupted', or 'error' mean the run is
    NOT done. Without --print-timeout a headless run waits for background
    tasks, so set one explicitly for CI/batched runs.
  * Exit codes — 0 ok; 1 = startup error (bad --agent, invalid --json-schema
    without an object root); 2 = usage error (e.g. --print + --prompt-interactive);
    3 = timed-out turn or model/API error (structured AGY_ERROR line on stderr).
  * denied_actions — headless runs cannot approve actions. If the result lists
    denied actions, add scoped permissions.allow rules (or change the policy);
    --dangerously-skip-permissions still honors explicit denies, the command
    denylist, enterprise policy, and artifact review.

Examples:
  agy_headless.py --prompt "Implement the failing test and make it pass" --timeout 1200
  agy_headless.py --prompt "..." --model claude-opus-5-5-high --effort high
  agy_headless.py --prompt "..." --schema schema.json --agent my-reviewer
  agy_headless.py --prompt "..." --resume <conversation-id>
  AGY_BIN=/usr/local/bin/agy agy_headless.py --prompt "hi"   # custom binary

Output: JSON on stdout: {ok, exit_code, finished_reason, result, denied_actions,
conversation_id, stderr_tail}. Exit code mirrors agy's exit code.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

AGY_BIN = os.environ.get("AGY_BIN", "agy")

VALID_OUTPUT_FORMATS = ("text", "json", "stream-json")


def build_cmd(args):
    cmd = [AGY_BIN, "-p", args.prompt, "--output-format", args.output_format]
    if args.model:
        cmd += ["--model", args.model]
    if args.effort:
        cmd += ["--effort", args.effort]
    if args.agent:
        cmd += ["--agent", args.agent]
    if args.schema:
        cmd += ["--json-schema", args.schema]
    if args.resume:
        cmd += ["--conversation", args.resume]
    elif args.continue_last:
        cmd += ["--continue"]
    if args.mode:
        cmd += ["--mode", args.mode]
    if args.project:
        cmd += ["--project", args.project]
    if args.timeout:
        cmd += ["--print-timeout", str(args.timeout)]
    if args.skip_permissions:
        cmd += ["--dangerously-skip-permissions"]
    return cmd


def parse_json_output(raw):
    """Extract result/finished_reason/denied_actions/conversation id from agy JSON output.

    Handles both a single JSON object and newline-delimited JSON events
    (stream-json style): later objects win for scalar fields, event lists merge.
    """
    result = {}
    events = []
    denied = []
    conversation_id = None
    finished_reason = None
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        events.append(obj)
        for key in ("result", "response", "output", "text"):
            if key in obj and isinstance(obj[key], (str, dict, list)):
                result = obj[key] if key in ("result", "response") else obj[key]
        if "finished_reason" in obj:
            finished_reason = obj["finished_reason"]
        if "denied_actions" in obj and isinstance(obj["denied_actions"], list):
            denied.extend(obj["denied_actions"])
        for key in ("conversation_id", "conversationId", "session_id"):
            if key in obj:
                conversation_id = obj[key]
    return result, events, denied, conversation_id, finished_reason


def run(args):
    cmd = build_cmd(args)
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=(args.timeout + 60) if args.timeout else None
        )
        exit_code = proc.returncode
        stdout, stderr = proc.stdout, proc.stderr
    except FileNotFoundError:
        print(json.dumps({
            "ok": False,
            "exit_code": 127,
            "error": "agy binary not found (set AGY_BIN or install: "
                     "curl -fsSL https://antigravity.google/cli/install.sh | bash)",
            "denied_actions": [],
            "finished_reason": None,
            "result": None,
            "conversation_id": None,
            "stderr_tail": "",
        }, indent=2))
        sys.exit(127)
    except subprocess.TimeoutExpired:
        print(json.dumps({
            "ok": False, "exit_code": 3, "error": "local subprocess timeout exceeded",
            "denied_actions": [], "finished_reason": "local_timeout",
            "result": None, "conversation_id": None, "stderr_tail": "",
        }, indent=2))
        sys.exit(3)

    result, events, denied, conversation_id, finished_reason = parse_json_output(stdout)

    agy_error = None
    for line in stderr.splitlines():
        if "AGY_ERROR" in line:
            agy_error = line.strip()

    ok = exit_code == 0 and finished_reason not in ("print_timeout", "interrupted", "error")

    out = {
        "ok": ok,
        "exit_code": exit_code,
        "finished_reason": finished_reason,
        "result": result if args.output_format != "text" else stdout.strip(),
        "denied_actions": denied,
        "conversation_id": conversation_id,
        "agy_error": agy_error,
        "stderr_tail": "\n".join(stderr.splitlines()[-10:]),
        "events": events if args.output_format == "stream-json" else None,
    }
    out = {k: v for k, v in out.items() if v is not None or k in ("ok", "exit_code", "denied_actions")}
    print(json.dumps(out, indent=2))
    sys.exit(exit_code)


def main():
    ap = argparse.ArgumentParser(description="Run a headless agy autonomous loop and report normalized status.")
    ap.add_argument("--prompt", "-p", required=True, help="Prompt / goal for the agent")
    ap.add_argument("--model", help="Model slug from `agy models`, e.g. claude-opus-5-5-high")
    ap.add_argument("--effort", help="Reasoning effort level for the selected model")
    ap.add_argument("--agent", help="Custom agent name from `agy agents`")
    ap.add_argument("--schema", help="Path to JSON schema file (object root required)")
    ap.add_argument("--resume", help="Conversation ID to resume")
    ap.add_argument("--continue-last", action="store_true", help="Continue most recent conversation")
    ap.add_argument("--mode", choices=["default", "accept-edits", "auto", "plan"])
    ap.add_argument("--project", help="Project name or ID")
    ap.add_argument("--output-format", default="json", choices=VALID_OUTPUT_FORMATS)
    ap.add_argument("--timeout", type=int, help="Headless --print-timeout in seconds (timed-out turn exits 3)")
    ap.add_argument("--skip-permissions", action="store_true",
                    help="Pass --dangerously-skip-permissions (still respects explicit denies, "
                         "denylist, enterprise policy, artifact review). Use only in sandboxed/CI envs.")
    args = ap.parse_args()

    if args.schema:
        try:
            with open(args.schema, "r", encoding="utf-8") as f:
                schema = json.load(f)
            if schema.get("type") != "object":
                print(json.dumps({"ok": False, "error":
                      "invalid --json-schema: root must have \"type\": \"object\" (agy exits 1 otherwise)"}))
                sys.exit(1)
        except (ValueError, OSError) as e:
            print(json.dumps({"ok": False, "error": "cannot read schema: %s" % e}))
            sys.exit(1)

    run(args)


if __name__ == "__main__":
    main()