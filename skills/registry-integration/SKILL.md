---
name: registry-integration
description: Reuse-or-build a focused BEHAVIORAL INTEGRATION MOCK for a third-party protocol (Morpho/Uniswap/Liquity/ERC4626/oracle…) for the recon-registry, so a project that integrates with it can be fuzzed under realistic, evolving conditions. Use when a fuzzing target depends on an external protocol and you need a registry "puzzle piece". REUSE-FIRST: it searches the published registry for an existing piece (and extends it) before authoring a new one. The goal is to subject the project to the integration's BEHAVIORS (incl. misbehaviors), NOT to test the integration's own soundness.
---

# registry-integration

You are asked to make a third-party integration usable inside Recon operator fuzzing — as a **behavioral mock** published to the registry. A piece's job: make the integration **behave the way it really would (including how it MISbehaves) as actors use it**, so the project being fuzzed (call it **X**) meets realistic, *evolving* cross-protocol conditions, and bugs in X that only appear under those dynamics surface.

> **We test the behaviors of OTHER systems as they affect X — not the soundness of those systems.** A piece is a behavior emulator, not a verified-correct implementation: it may be deliberately wrong/adversarial (revert bombs, unbacked share inflation, stale prices) precisely because X must survive that. Never write invariants/properties for the integration itself.

## What a piece IS (and is not)
A piece is **one self-contained, deployable contract** that:
- **Models / reproduces the surface X touches** — the entry points X actually calls + the behaviors X depends on (interest accrual, price impact, rounding *direction*, liquidation triggers, utilization, revert/return-data quirks). Stub or omit what X never touches. Be faithful on what affects X — including the adversarial behaviors.
- **Is deployable on its own.** It either *is* a faithful mock you already have, or a focused one you write. It must compile to bytecode the operator can deploy by name.
- **Takes its dependencies as CONSTRUCTOR ARGUMENTS** (see §3) — the asset/token/oracle addresses it wires to are **passed in by the consumer at deploy time**, not fabricated inside the piece.

A piece is **NOT** a full deploy of the real protocol, and **NOT** a test of the integration's own invariants. No `BaseTargets`/`Asserts`/ghosts/`property_*` in a piece — X's invariants live in X's suite.

### Already have a faithful mock? That's (almost) the piece.
If a contract already reproduces the integration's behavior (e.g. a `MockERC4626Tester`, a `MockOracle`), **packaging it IS the port** — do NOT wrap it in a second contract, re-implement it, mint your own deps, or bolt on modifiers it doesn't need. The only changes you may need: make its **constructor accept the deps it needs as args** (so the consumer wires real addresses), and add behavioral handlers/admin knobs **only if** they're missing. Minimal change beats a rewrite.

### asActor / asAdmin are OPTIONAL — only when the caller matters
When the piece is deployed via `deploy_from_registry`, the operator **auto-registers every mutating function as a fuzzable action, drives each one with an actor as `msg.sender`, registers the deployed address under the entry name, and mints its mock assets to the actors** (actor→spender allowances come from the built-in `asset_approve` fuzz action / X's suite, not from the piece). So for a plain mock that runs against a **consumer-supplied asset** you **do not need `asActor`/`asAdmin` modifiers, an `rvm` import, a `fund()` loop, or self-registration** — the engine does the wiring. Just expose the functions. (A piece that deploys its **own** tokens does need to mint + approve actors for those — see `behaviors-catalog.md`.)

Reach for the modifiers ONLY when caller identity genuinely matters:
- `asAdmin` (deployer-gated) — for a config setter you want gated to one identity so the fuzzer flips it deliberately rather than any actor calling it ad hoc.
- `asActor` — when a handler must orchestrate *several* calls as one consistent identity (e.g. approve-then-act inside one function), so they don't get split across different fuzzed senders.

A pure mock whose functions are independently fuzzable needs neither.

> Deep dives: `references/model.md` (the model + why), `references/behaviors-catalog.md` (what to reproduce faithfully per integration class — the heart), `references/registry-cli.md` (schema + CLI + CI gate), `references/wiring-into-operator.md` (how it plugs into a suite).

## Preconditions
1. `forge` available; you can `git clone` the integration's repo (or you know its interface / already have the mock).
2. `npx recon-registry --version` works.
3. You know **how X uses the integration** (which functions, which return values/state X depends on) — that defines the scope. If X isn't available, model the integration's *standard* surface for that class.
4. **Working dir:** default to a throwaway scratch under `/tmp` (`/tmp/recon-registry-<EntryName>/`); use a forced path only when the user gives one — never pollute the user's cwd.

## The 0→100 loop

### 0. Reuse before you build (search first)
The registry is a shared library — **reuse-first, extend over duplicate, author-once-reuse-many.**
- **Search:** `npx recon-registry list` (the published catalog: name / tags / description) and/or the operator's `registry_search("<integration>")` — find candidates by name/tag.
- **Match → reuse:** if a piece covers the touched surface + the requested behaviors, you're done — `cache_registry_entry(name)` and it's ready to deploy. ONE piece usually already covers many "scenarios" (fee on/off, high/low utilization, liquidations): the fuzzer reaches A/B/C by driving its functions — **no new entry needed.** A matching piece *is* the answer.
- **Partial match → extend:** missing a behavior/handler/knob? **Extend that entry** (add the function, re-`pack`, re-`publish`) — don't duplicate.
- **No match → build:** only then author a new piece (steps 1→7 below).

### 1. Scope (the most important step)
- Clone/locate the integration (and X if available). Identify:
  - **The touched surface** — the exact functions X calls + the values/state X reads back.
  - **The behaviors that matter** — what must move/misbehave realistically for X to be exercised (price, rate, share price, health factor, liquidation, revert/return-data quirks). See `references/behaviors-catalog.md` for your class.
  - **The edge cases** a dependent breaks on (rounding direction, zero/max, first-depositor, stale/extreme price, partial liquidation, hostile reverts).
- Decide per element: **reproduce faithfully** (it affects X) vs **stub** (X reads it but a constant/simple value suffices) vs **omit** (X never touches it). Bias hard toward small.

### 2. Scaffold
**Default to a `/tmp` scratch dir; use a forced path only when given.** If the user gave no output path, create + work in a temp Foundry project at `/tmp/recon-registry-<EntryName>/` (clone the integration and run everything there) so their cwd is never polluted. If the user forced a path (e.g. `/Users/.../registry-e2e-4626`), use that exactly.
```bash
cd /tmp/recon-registry-<EntryName>   # (or the forced path) — a Foundry project
npx recon-registry init              # → recon-registry.toml + registry/{Harness.sol,Rvm.sol,IERC20.sol,README.md}
```
`Rvm.sol`/`IERC20.sol` are there **if you need them** (you only do for the optional modifiers/cheatcodes). A pure mock that imports OpenZeppelin / the protocol's own code can ignore them. If you already have the mock contract, point `recon-registry.toml`'s `source`/`harness` at it (it can live in `src/`); you don't have to move it into `registry/`.

### 3. Build the piece (one self-contained, deployable contract)
Either package the mock you already have, or write a focused one. Then:
- **Dependencies come in through the CONSTRUCTOR.** The asset/token/oracle/pool addresses the piece wires to are **constructor arguments**, passed by the consumer at deploy time:
  ```solidity
  constructor(address _asset) ERC4626(IERC20(_asset)) ERC20("Vault","V") { }
  ```
  At deploy: `deployFromRegistry("MyPiece", abi.encode(asset))` (cheatcode) or `deploy_from_registry("MyPiece", [asset])` (MCP) forwards those args. **Do NOT fabricate deps the consumer should choose** — no `rvm.getAsset()` (that forces the piece onto whatever asset happens to be current) and no `new MyOwnMockToken()` for the underlying. Let X decide which token/asset/oracle the integration runs against. (Fabricate internally ONLY for state the consumer never needs to control — seed reserves, an internal bookkeeping struct.)
- **Imports are whatever makes it a faithful single contract** — OpenZeppelin, the protocol's own libraries, inheritance, internal `new` of helper contracts (all embedded in the creation bytecode). The ONE hard rule: **don't import the operator suite framework** (`BaseTargets`/`Asserts`/ghosts/`property_*`). `Rvm`/`IERC20` are available but optional.
- **Expose the behaviors as plain external functions.** Every mutating function auto-registers as a fuzz action and is driven by actors — so just having `deposit/withdraw/swap/borrow/...` (and the adversarial knobs: `setRevertBehaviour`, `increaseYield`, `mintUnbackedShares`, `setPrice`, …) is enough. No modifiers required (see "asActor/asAdmin are OPTIONAL" above) unless caller identity matters for that function.
- `forge build` must pass.
- See `references/behaviors-catalog.md` for the exact dynamics + adversarial knobs + per-class sketches.

### 4. Declare labels — ONLY what your constructor actually registers
The operator **auto-registers the deployed contract's address under the entry name** — X resolves the main piece with `getAddr("<EntryName>")` (e.g. `getAddr("MockERC4626Tester")`). So **do NOT list the main contract in `labels`.**

Use `recon-registry.toml` `labels = [...]` **only for ADDITIONAL internal addresses your constructor explicitly `rvm.register`s** (e.g. a piece that deploys its own loan/collateral tokens or sub-pools). Prefix each with the entry name — the `getAddr` namespace is shared by the suite + all pieces, so a bare `"market"`/`"pool"`/`"token"` would collide:
```solidity
rvm.register("MorphoMock.loanToken", address(loanToken));   // an internal dep the piece itself deploys
```
A self-contained mock that registers nothing internally (the common case — e.g. an ERC4626 tester whose asset is a constructor arg) → **`labels = []`**. **Never declare a label your contract doesn't actually `rvm.register`** — that advertises a phantom address that won't resolve. (Plain strings, no engine change, no clash with `loadVar` dot-paths.)

### 5. Pack
```bash
npx recon-registry pack     # forge build + extract → recon-registry-out/<name>.json (bytecode+abi+source+solc)
```

### 6. Validate
Schema-valid; the CI gate is **bytecode == recompile(source, solc)** (reproducibility) + a smoke deploy. Make sure `source` is inlined and `solc` matches.

### 7. Publish — actually open the PR (don't stop at `pack`)
```bash
npx recon-registry publish  # branch + commit the entry + open a PR (via the gh CLI / GitHub API)
```
With `gh` authenticated (`gh auth login`, write access to the registry repo) this opens the PR **directly through the GitHub API — no browser, no size cap** (it commits the entry to a branch and opens the PR; works for multi-MB entries). Without `gh`/write access it falls back to a prefilled issue you submit by hand. On merge the entry is live + deployable by name. **The task isn't done until the PR is open** — unless you were explicitly told to stop before publishing.

## Anti-patterns
- **Don't wrap / re-implement a mock you already have.** If a faithful mock exists, package it (constructor takes its deps); don't add a second wrapper contract, re-derive its logic, or bolt on modifiers it doesn't need.
- **Don't fabricate deps the consumer should pick.** Take the asset/token/oracle as a **constructor arg**; don't `rvm.getAsset()` or `new` your own underlying. The piece must run against whatever asset X uses.
- **Don't add `asActor`/`asAdmin` (or `rvm`/`fund()`/self-register) reflexively.** The operator drives functions with actors, funds them, and registers the label. Add the modifiers only when caller identity matters.
- **Don't deploy the real protocol in full.** Reproduce the touched surface + the behaviors that affect X; stub/omit the rest.
- **Don't test the integration's invariants.** No `Asserts`/ghosts/`property_*` in a piece — and remember the piece may be deliberately unsound. X's suite owns invariants.
- **Don't import the operator suite framework** (`BaseTargets`/`Asserts`/ghosts/properties). OZ / the protocol's own code is fine.
- **Don't skip faithfulness on the behavior that matters.** A swap with no price impact, a market with a static rate, a vault that never misbehaves — none of those perturb X. The point is the *evolving* / adversarial condition.
- **Don't declare phantom labels.** Put in `labels` ONLY the sublabels your constructor actually `rvm.register`s, entry-name-prefixed; the main contract is auto-registered under the entry name (don't list it). A self-contained mock that registers nothing → `labels = []`.
- **Don't stop at `pack`.** Run `publish` to open the PR — that's the deliverable (unless told to stop before publishing).

## References
- `references/model.md` — the behavioral-mock model + rationale.
- `references/behaviors-catalog.md` — per-class dynamics + edge cases to reproduce (lending, AMM, CDP, vault, oracle).
- `references/registry-cli.md` — entry schema, `init`/`pack`/`publish`, the reproducibility gate.
- `references/wiring-into-operator.md` — how the piece plugs into an operator suite (cross-ref the operator-prove skill).
</content>
