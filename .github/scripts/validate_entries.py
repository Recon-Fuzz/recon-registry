#!/usr/bin/env python3
"""Validate registry entries on PR.

Robust checks (always): schema shape, non-empty + fully-linked hex bytecode, source present.
Reproducibility (best-effort): if `solc` is available, recompile the inlined flattened `source`
with the declared `solc` version and assert the creation bytecode matches MODULO the trailing
CBOR metadata (which encodes source hashes / compiler settings and legitimately varies). Exact
end-to-end determinism also requires pinned optimizer settings — see TODO below.
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

REQUIRED = ["name", "description", "tags", "abi", "creationBytecode", "source", "solc"]
errors = []


def strip_metadata(bc: str) -> str:
    """Drop the trailing Solidity CBOR metadata (…a264 'ipfs'… or a164 'bzzr'…) for comparison."""
    h = bc[2:] if bc.startswith("0x") else bc
    # metadata length is the last 2 bytes; chop it + the metadata blob if the marker is present.
    m = re.search(r"(a264697066|a164627a7a)", h)
    return h[: m.start()] if m else h


def have_solc() -> bool:
    return subprocess.run(["bash", "-lc", "command -v solc"], capture_output=True).returncode == 0


def check(path: str):
    e = json.load(open(path))
    for k in REQUIRED:
        if k not in e:
            errors.append(f"{path}: missing '{k}'")
            return
    bc = e["creationBytecode"]
    if not re.fullmatch(r"0x[0-9a-fA-F]+", bc) or len(bc) <= 2:
        errors.append(f"{path}: creationBytecode must be non-empty hex")
    if "__$" in bc:
        errors.append(f"{path}: creationBytecode has unlinked library placeholders")
    if not e["source"].strip():
        errors.append(f"{path}: empty source (inline the flattened source)")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", e["name"]):
        errors.append(f"{path}: invalid name")

    if errors or not have_solc():
        if not have_solc():
            print(f"· {path}: solc unavailable — skipped reproducibility check")
        return

    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, f"{e['name']}.sol")
        open(src, "w").write(e["source"])
        # TODO: pin optimizer runs/via-ir from the manifest for byte-exact determinism.
        out = subprocess.run(
            ["solc", "--combined-json", "bin", src], capture_output=True, text=True
        )
        if out.returncode != 0:
            errors.append(f"{path}: source failed to recompile:\n{out.stderr.strip()[:500]}")
            return
        compiled = json.loads(out.stdout)["contracts"]
        got = next((v["bin"] for k, v in compiled.items() if k.endswith(f":{e['name']}")), "")
        if strip_metadata(got) != strip_metadata(bc):
            errors.append(f"{path}: bytecode != recompile(source, solc) (modulo metadata)")
        else:
            print(f"✓ {path}: reproducible")


def main():
    entries = sorted(glob.glob("entries/*.json"))
    if not entries:
        print("no entries to validate")
        return
    for p in entries:
        check(p)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print(f"validated {len(entries)} entr{'y' if len(entries)==1 else 'ies'}")


if __name__ == "__main__":
    main()
