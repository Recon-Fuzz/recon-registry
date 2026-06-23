#!/usr/bin/env python3
"""Extract a submitted entry into entries/<name>.json.

Source is either:
  - ENTRY_JSON env (from a `repository_dispatch` client_payload.entry), or
  - BODY env (a "Submit a registry entry" issue body — the entry pasted into a ```json block).
Writes entries/<name>.json and emits the entry name to $GITHUB_OUTPUT.
"""
import json
import os
import re
import sys

entry = None

ej = os.environ.get("ENTRY_JSON", "").strip()
if ej and ej != "null":
    try:
        entry = json.loads(ej)
    except json.JSONDecodeError:
        pass

if entry is None:
    body = os.environ.get("BODY", "")
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", body, re.DOTALL) or re.search(r"(\{.*\})", body, re.DOTALL)
    if m:
        try:
            entry = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            print(f"::error::entry JSON is invalid: {e}", file=sys.stderr)
            sys.exit(1)

if entry is None:
    print("::error::no entry JSON found (neither client_payload nor a ```json block)", file=sys.stderr)
    sys.exit(1)

name = entry.get("name", "")
if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
    print(f"::error::invalid or missing entry name: {name!r}", file=sys.stderr)
    sys.exit(1)

os.makedirs("entries", exist_ok=True)
path = f"entries/{name}.json"
with open(path, "w") as f:
    json.dump(entry, f, indent=1)
print(f"wrote {path}")

with open(os.environ["GITHUB_OUTPUT"], "a") as out:
    out.write(f"name={name}\n")
    out.write(f"path={path}\n")
