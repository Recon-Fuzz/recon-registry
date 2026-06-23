#!/usr/bin/env python3
"""Extract a submitted entry into entries/<name>.json from: a repository_dispatch payload, an
uploaded file in the issue body, or a pasted ```json block. Emits the entry name."""
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

entry = None
ej = os.environ.get("ENTRY_JSON", "").strip()
if ej and ej != "null":
    try:
        entry = json.loads(ej)
    except json.JSONDecodeError:
        pass

body = os.environ.get("BODY", "")

# uploaded file (issue body has a user-attachments URL)
if entry is None:
    m = re.search(r"https://github\.com/user-attachments/files/\d+/[^\s)]+\.(?:txt|json|yaml|yml|zip)", body)
    if m:
        url = m.group(0)
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {os.environ.get('GITHUB_TOKEN','')}",
            "User-Agent": "recon-registry", "Accept": "application/octet-stream"})
        data = urllib.request.urlopen(req, timeout=30).read()
        if url.endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(data))
            jn = next((n for n in z.namelist() if n.endswith((".json", ".txt"))), None)
            data = z.read(jn)
        entry = json.loads(data)

# pasted ```json block
if entry is None:
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", body, re.DOTALL) or re.search(r"(\{.*\})", body, re.DOTALL)
    if m:
        entry = json.loads(m.group(1))

if entry is None:
    print("::error::no entry found (dispatch payload, uploaded file, or pasted JSON)", file=sys.stderr)
    sys.exit(1)

name = entry.get("name", "")
if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
    print(f"::error::invalid or missing entry name: {name!r}", file=sys.stderr)
    sys.exit(1)

os.makedirs("entries", exist_ok=True)
path = f"entries/{name}.json"
json.dump(entry, open(path, "w"), indent=1)
print(f"wrote {path}")
with open(os.environ["GITHUB_OUTPUT"], "a") as out:
    out.write(f"name={name}\npath={path}\n")
