#!/usr/bin/env python3
"""Rebuild registry.json (the catalog index) from entries/*.json. Run on merge to main.

The index carries only the lightweight discovery fields — consumers fetch the full entry JSON
(with bytecode/abi/source) by name when deploying.
"""
import glob
import json

entries = []
for p in sorted(glob.glob("entries/*.json")):
    e = json.load(open(p))
    entries.append(
        {
            "name": e["name"],
            "description": e.get("description", ""),
            "tags": e.get("tags", []),
            "solc": e.get("solc", ""),
            "path": p,
        }
    )

json.dump({"version": 1, "entries": entries}, open("registry.json", "w"), indent=1)
print(f"indexed {len(entries)} entries")
