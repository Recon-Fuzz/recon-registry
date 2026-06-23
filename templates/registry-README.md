# registry/ — your fuzzing harness entry

This folder was scaffolded by `npx recon-registry init`. It packages your project into a single
self-contained harness for the [recon-registry](https://github.com/Recon-Fuzz/recon-registry),
deployable by name from the Recon operator.

- `Harness.sol` — your harness: its constructor stands up the whole project (see the TODOs).
- `Rvm.sol` — the `rvm` cheatcode interface the harness uses (`getActors`, `prank`, …).
- `../recon-registry.toml` — the entry manifest (name, description, tags, harness, solc).

## Flow
```
# edit Harness.sol + recon-registry.toml
npx recon-registry pack       # forge build + extract entry → recon-registry-out/<name>.json
npx recon-registry publish    # open a PR to the registry  →  merge = live for everyone
```
