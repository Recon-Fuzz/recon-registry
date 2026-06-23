#!/usr/bin/env python3
"""Extract a submitted entry into entries/<name>.json.

Source, in priority order:
  1. ENTRY_JSON env  — from a `repository_dispatch` client_payload.entry (maintainer path).
  2. an ATTACHED .json file URL in the issue body (drag-dropped) — downloaded (large entries).
  3. a pasted ```json block in the issue body (small entries).
Writes entries/<name>.json and emits the entry name to $GITHUB_OUTPUT.
"""
import json
import os
import re
import sys
import urllib.request

body = os.environ.get("BODY", "")
entry = None

# 1. repository_dispatch payload
ej = os.environ.get("ENTRY_JSON", "").strip()
if ej and ej != "null":
    try:
        entry = json.loads(ej)
    except json.JSONDecodeError:
        pass

# 2. attached .json file (GitHub uploads drag-dropped files to a user-attachments URL)
if entry is None:
    am = re.search(
        r"https://(?:github\.com/user-attachments/files/\d+/[^\s)]+\.json"
        r"|[^\s)]*githubusercontent\.com/[^\s)]+\.json)",
        body,
    )
    if am:
        url = am.group(0)
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {os.environ.get('GITHUB_TOKEN', '')}",
                "User-Agent": "recon-registry",
                "Accept": "application/octet-stream",
            },
        )
        try:
            data = urllib.request.urlopen(req, timeout=30).read()
            entry = json.loads(data)
        except Exception as e:  # noqa: BLE001
            print(f"::error::failed to download/parse attached entry: {e}", file=sys.stderr)
            sys.exit(1)

# 3. pasted JSON block
if entry is None:
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", body, re.DOTALL) or re.search(r"(\{.*\})", body, re.DOTALL)
    if m:
        try:
            entry = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            print(f"::error::pasted entry JSON is invalid: {e}", file=sys.stderr)
            sys.exit(1)

if entry is None:
    print("::error::no entry found (no dispatch payload, attached .json, or pasted JSON)", file=sys.stderr)
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
