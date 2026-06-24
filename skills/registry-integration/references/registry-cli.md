# Registry CLI, entry schema & the reproducibility gate

## Entry schema (`schema/entry.schema.json`)
One entry = one self-contained deployable contract. Fields:
- `name` — unique; the file name and the deploy-by-name key (`[A-Za-z0-9_.-]+`).
- `description` — one line.
- `author` — optional attribution.
- `tags` — discovery tags (e.g. `lending`, `amm`, `cdp`, `vault`, `oracle`, `mock`, `integration`).
- `abi` — standard Solidity ABI (to encode any args + interact).
- `creationBytecode` — linked creation (init) bytecode; **fully library-linked** (no `__$` placeholders), embeds any `new`'d deps. Self-contained.
- `source` — inlined Solidity source (so humans + the operator can see exactly what it does).
- `solc` — the solc version it was built with.
- `labels` — optional; the `rvm` labels this entry registers at deploy, **prefixed with the entry name** (e.g. `"LendingMock.lending"`, `"LendingMock.loanToken"`) so they never collide with the suite's or other pieces' labels in the SHARED `getAddr` namespace. `pack` reads `[entry].labels` from the toml and persists them here; consumers `getAddr("<EntryName>.<label>")`.

No provenance beyond `solc` — trust comes from the CI reproducibility check.

## CLI (`npx recon-registry <cmd>`)
- **`init`** — run in a Foundry project. Scaffolds `recon-registry.toml` + `registry/{Harness.sol, Rvm.sol, IERC20.sol, README.md}` (idempotent; prefills author from git).
- **`pack`** — `forge build` (with `[build].skip` to dodge clashing basenames), extracts the concrete artifact (asserts non-empty, fully-linked bytecode), inlines the source, stamps `solc`, writes `recon-registry-out/<name>.json`.
- **`publish`** — submits the entry to the registry repo's Action, which validates it and opens a PR. **No `gh` needed:** with a `GH_TOKEN`/`GITHUB_TOKEN` it fires a `repository_dispatch`; otherwise it opens a prefilled issue in your browser and reveals the entry file to drag in. On merge, `registry.json` is rebuilt and the entry is live + deployable by name.
- **`list`** — list published entries. (`--version` prints the CLI version.)

## `recon-registry.toml`
```toml
[entry]
name = "LendingMock"
description = "Behavioral mock of a single lending market — supply/borrow/accrue/liquidate"
tags = ["lending", "integration", "mock"]
harness = "LendingMock"          # the contract pack extracts
labels = ["LendingMock.lending","LendingMock.loanToken","LendingMock.collToken"]  # entry-name-prefixed (shared namespace); pack persists them
[build]
solc = "0.8.24"                  # MUST match your toolchain (the reproducibility gate recompiles with it)
skip = ["test/recon/**"]
```

## The CI gate (what your PR must pass)
1. **Reproducibility:** `bytecode == recompile(source, solc)` — the committed `creationBytecode` must byte-match a fresh compile of the inlined `source` with the stamped `solc`. This is the highest-friction step; the byte-match killers are metadata + settings drift between your build and CI. Make it deterministic in your **`foundry.toml`**: pin `solc` to your toolchain, pin `optimizer`/`optimizer_runs`, and set **`bytecode_hash = "none"`** (drops the CBOR metadata/IPFS hash that otherwise perturbs the bytecode). Keep `source` complete + self-contained. (CI recompiles with the stamped `solc`; a different optimizer/metadata config = fail.)
2. **Schema validation.**
3. **Smoke deploy.**

## Single-contract rules
- No unresolved deployed-library linking (`pack` rejects `__$` placeholders). Cause: a `library` with `external`/`public` functions becomes a *deployed* library → an unlinkable `__$...$` placeholder. Fix: make embedded library functions **`internal`** so they inline (or link the lib).
- No constructor args (the piece deploys/wires itself and pulls actors via `rvm`).
- `new`'d mocks/deps are embedded into the creation bytecode → the entry stays one artifact.
</content>
