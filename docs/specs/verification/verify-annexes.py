#!/usr/bin/env python3
"""Réexécute le code des « Annexe V — Code de vérification numérique » des spécifications
et compare chaque sortie à celle qui est consignée dans le document.

Usage (depuis la racine du dépôt) :
    python3 docs/specs/verification/verify-annexes.py            # tous les documents
    python3 docs/specs/verification/verify-annexes.py 14 03      # seulement Doc_14 et Doc_03

Aucune dépendance hors bibliothèque standard (Python >= 3.10). Code de sortie : 0 si tout est identique, 1 sinon.
"""
import pathlib
import re
import subprocess
import sys
import tempfile

SPECS = pathlib.Path(__file__).resolve().parent.parent
BLOCK = re.compile(
    r"<!-- verif:(?P<id>\d{2}-\d{2}):code -->\n```python\n(?P<code>.*?)\n```\n"
    r".*?<!-- verif:(?P=id):resultat -->\n```text\n(?P<out>.*?)\n```",
    re.S,
)


def lines(text: str) -> list[str]:
    return [line.rstrip() for line in text.strip("\n").split("\n")]


def main(argv: list[str]) -> int:
    wanted = set(argv)
    total = failures = 0
    for spec in sorted(SPECS.glob("[0-9][0-9]-*.md")):
        if wanted and spec.name[:2] not in wanted:
            continue
        for match in BLOCK.finditer(spec.read_text(encoding="utf-8")):
            total += 1
            with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as handle:
                handle.write(match["code"] + "\n")
            run = subprocess.run([sys.executable, handle.name], capture_output=True, text=True, timeout=120)
            pathlib.Path(handle.name).unlink()
            same = run.returncode == 0 and lines(run.stdout) == lines(match["out"])
            failures += 0 if same else 1
            print(f"{'OK   ' if same else 'ECART'} {spec.name} bloc {match['id']}")
            if not same:
                got, expected = lines(run.stdout), lines(match["out"])
                for index in range(max(len(got), len(expected))):
                    a = got[index] if index < len(got) else "<absent>"
                    b = expected[index] if index < len(expected) else "<absent>"
                    if a != b:
                        print(f"      ligne {index + 1}\n        obtenu  : {a[:200]}\n        consigné: {b[:200]}")
                        break
                if run.stderr:
                    print("      " + run.stderr.strip().splitlines()[-1][:300])
    print(f"{total - failures}/{total} blocs identiques")
    if total == 0:
        print("Aucun bloc trouvé : vérifier le chemin ou les numéros de document.")
        return 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
