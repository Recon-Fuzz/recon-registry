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
- `labels` — optional; **only the ADDITIONAL internal addresses the piece's constructor explicitly `rvm.register`s** (e.g. `"LendingMock.loanToken"` for a token the piece itself deploys), **prefixed with the entry name** so they never collide in the SHARED `getAddr` namespace. **Do NOT list the main contract** — the operator auto-registers the deployed address under the entry name (`getAddr("<EntryName>")`). A self-contained mock that registers nothing internally → `labels = []`. Never declare a label the contract doesn't actually register (a phantom label that won't resolve). `pack` reads `[entry].labels` from the toml and persists them here.

No provenance beyond `solc` — trust comes from the CI reproducibility check.

## CLI (`npx recon-registry <cmd>`)
- **`init`** — run in a Foundry project. Scaffolds `recon-registry.toml` + `registry/{Harness.sol, Rvm.sol, IERC20.sol, README.md}` (idempotent; prefills author from git).
- **`pack`** — `forge build` (with `[build].skip` to dodge clashing basenames), extracts the concrete artifact (asserts non-empty, fully-linked bytecode), inlines the source, stamps `solc`, writes `recon-registry-out/<name>.json`.
- **`publish`** — opens a PR that adds the entry to the registry repo, entirely via the GitHub API (no clone). With the `gh` CLI authenticated (`gh auth login`, write access to the repo) it creates a branch, commits the entry, and opens the PR **directly — no browser, no payload-size cap** (handles multi-MB entries). Without `gh`/write access it falls back to a prefilled issue you submit by hand. On merge, `registry.json` is rebuilt and the entry is live + deployable by name.
- **`list`** — list published entries. (`--version` prints the CLI version.)

## `recon-registry.toml`
```toml
[entry]
name = "LendingMock"
description = "Behavioral mock of a single lending market — supply/borrow/accrue/liquidate"
tags = ["lending", "integration", "mock"]
harness = "LendingMock"          # the contract pack extracts
labels = ["LendingMock.loanToken","LendingMock.collToken"]  # ONLY internal deps the constructor rvm.registers
                                 #   (entry-name-prefixed). The market itself resolves via getAddr("LendingMock")
                                 #   (auto-registered) — don't list it. A self-contained mock → labels = []
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
- **The constructor MAY take args** — deps the consumer chooses (the asset/token/oracle address) are passed at deploy via `deployFromRegistry("<name>", abi.encode(args))` / `deploy_from_registry("<name>", [args])`. Don't fabricate consumer-chosen deps inside the piece (no `rvm.getAsset()`, no self-minted underlying). Fabricate internally only for state the consumer never controls (seed reserves, bookkeeping).
- `new`'d helper mocks/deps are embedded into the creation bytecode → the entry stays one artifact.
</content>
