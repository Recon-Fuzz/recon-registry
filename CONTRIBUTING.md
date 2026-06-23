# Contributing an entry

An entry is **one self-contained contract** — a whole-project harness (its constructor `new`s and
wires everything) or a standalone mock/tester. One contract, one JSON, one deploy.

## 1. Scaffold (in your Foundry project)
```
npx recon-registry init
```
Creates `recon-registry.toml` and `registry/{Harness.sol,Rvm.sol,README.md}` (idempotent).

## 2. Write the harness
Edit `registry/Harness.sol` — its constructor should stand the entire project up: `new` the
protocol + mocks, read `rvm.getActors()`, fund/approve each actor. Deps `new`'d here are embedded
into the harness creation bytecode, so the entry stays a single self-contained artifact. Fill in
`recon-registry.toml` (`name`, `description`, `tags`, `harness`, `solc`).

Rules:
- **Single contract.** No external deployed-library linking left unresolved (link libs, or use
  internal libraries). `pack` rejects unlinked bytecode (`__$` placeholders).
- **No constructor args** for whole-project harnesses (pull actors via `rvm`). Mocks may take args.
- Keep `[build].skip` set so clashing basenames (e.g. multiple `MockERC20.sol`) don't clobber the
  artifact.

## 3. Pack
```
npx recon-registry pack
```
Runs `forge build`, extracts the concrete artifact (asserts non-empty, linked bytecode), inlines
the source, stamps `solc`, and writes `recon-registry-out/<name>.json`.

## 4. Publish
```
npx recon-registry publish
```
Forks this repo, adds your entry on a branch, and opens a PR (needs `gh` auth).

## CI gate
Your PR must pass: **bytecode == recompile(source, solc)** (reproducibility), schema validation,
and a smoke deploy. On merge, `registry.json` is rebuilt and your entry is live for everyone.

## Schema
See `schema/entry.schema.json`. Entries: `name, description, tags, abi, creationBytecode, source,
solc`. No provenance beyond `solc` — trust comes from the CI reproducibility check.
