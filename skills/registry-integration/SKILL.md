---
name: registry-integration
description: Reuse-or-build a focused BEHAVIORAL INTEGRATION MOCK for a third-party protocol (Morpho/Uniswap/Liquity/ERC4626/oracle…) for the recon-registry, so a project that integrates with it can be fuzzed under realistic, evolving conditions. Use when a fuzzing target depends on an external protocol and you need a registry "puzzle piece". REUSE-FIRST: it searches the published registry for an existing piece (and extends it) before authoring a new one. NOT for testing the integration's own invariants.
---

# registry-integration

You are asked to make a third-party integration usable inside Recon operator fuzzing — as a **behavioral mock** published to the registry. A piece's job: make the integration **behave the way it really would as actors use it**, so the project being fuzzed (call it **X**) meets realistic, *evolving* cross-protocol conditions, and bugs in X that only appear under those dynamics surface.

## What a piece IS (and is not)
A piece is **one self-contained contract** that:
- **Models only the surface X touches** — the few entry points X actually calls. Mock / stub / omit everything else (internal math you don't depend on, governance, peripheral modules, IRMs/oracles X never reads).
- **Is faithful on the dynamics that affect X** — the behaviors a bug in X would hinge on: interest accrual, price impact, rounding *direction*, liquidation triggers, utilization. Model *those* realistically.
- **Exposes handlers in two flavors:**
  - `asActor` — the natural user churn (swap, supply/borrow/repay, add/remove liquidity, liquidate).
  - `asAdmin` — the integration's **important admin/config knobs** (set/unset fee, change rate/IRM params, set LLTV/liquidation params, set the oracle price, set fee tier, pause). Admin-driven config changes on the integration shift **X's economics**, so they must be fuzzable too. **Authorize the deployer, mock the auth** — don't reproduce the real role/governance/timelock; just gate the setter on `getActor("deployer")` (the `asAdmin` modifier does this) so the fuzzer can flip it.
- **Registers its entry points by label** so X's suite resolves them via `rvm.getAddr("...")`.

A piece is **NOT** a full deploy of the real protocol, and **NOT** a test of the integration's own invariants (those are audited third parties; X's invariants live in X's suite). Deps are **`Rvm` + `IERC20` only**; `asActor`/`asAdmin` are inlined. No `BaseTargets`/`Asserts`/ghosts/properties.

> Deep dives: `references/model.md` (the model + why), `references/behaviors-catalog.md` (what to model faithfully per integration class — the heart), `references/registry-cli.md` (schema + CLI + CI gate), `references/wiring-into-operator.md` (how it plugs into a suite).

## Preconditions
1. `forge` available; you can `git clone` the integration's repo (or you know its interface).
2. `npx recon-registry --version` works.
3. You know **how X uses the integration** (which functions, which return values/state X depends on) — that defines the scope. If X isn't available, model the integration's *standard* surface for that class.
4. **Working dir:** default to a throwaway scratch under `/tmp` (`/tmp/recon-registry-<EntryName>/`); use a forced path only when the user gives one — never pollute the user's cwd.

## The 0→100 loop

### 0. Reuse before you build (search first)
The registry is a shared library — **reuse-first, extend over duplicate, author-once-reuse-many.**
- **Search:** `npx recon-registry list` (the published catalog: name / tags / description) and/or the operator's `registry_search("<integration>")` — find candidates by name/tag.
- **Match → reuse:** if a piece covers the touched surface + the requested behaviors, you're done — `cache_registry_entry(name)` and it's ready to deploy. Behavioral pieces use LIVE `asActor`/`asAdmin` handlers, so ONE piece usually already covers many "scenarios" (fee on/off, high/low utilization, liquidations): the fuzzer reaches A/B/C by driving those handlers — **no new entry needed.** A matching piece *is* the answer.
- **Partial match → extend:** missing a behavior/handler/knob? **Extend that entry** (add the handler, re-`pack`, re-`publish`) — don't duplicate.
- **No match → build:** only then author a new piece (steps 1→7 below).

### 1. Scope (the most important step)
- Clone/locate the integration (and X if available). Identify:
  - **The touched surface** — the exact functions X calls + the values/state X reads back.
  - **The dynamics that matter** — what must move realistically for X to be exercised (price, rate, share price, health factor, liquidation). See `references/behaviors-catalog.md` for your class.
  - **The edge cases** a dependent breaks on (rounding direction, zero/▒max, first-depositor, stale/extreme price, partial liquidation).
- Decide per element: **model faithfully** (it affects X) vs **stub** (X reads it but a constant/simple value suffices) vs **omit** (X never touches it). Bias hard toward small.

### 2. Scaffold
**Default to a `/tmp` scratch dir; use a forced path only when given.** If the user gave no output path, create + work in a temp Foundry project at `/tmp/recon-registry-<EntryName>/` (clone the integration and run everything there) so their cwd is never polluted. If the user forced a path (e.g. `/Users/.../registry-e2e-4626`), use that exactly.
```bash
cd /tmp/recon-registry-<EntryName>   # (or the forced path) — a Foundry project
npx recon-registry init              # → recon-registry.toml + registry/{Harness.sol,Rvm.sol,IERC20.sol,README.md}
```

### 3. Build the mock (one self-contained contract)
Rename `registry/Harness.sol`'s contract. Then:
- **Inlined modifiers** (already in the template): `asActor` = prank current actor, `asAdmin` = prank `deployer`.
- **`constructor() asAdmin` — takes NO arguments** (a piece self-deploys, wires, and funds itself, pulling actors via `rvm`; it's deployed by name with no args). Deploy ONLY the touched surface (a focused mock; `new` minimal mock tokens/state), set up minimal initial state so X's calls succeed (seed liquidity / create the market / open a seed position), `rvm.register("<label>", addr)` the entry points, and fund + approve every `rvm.getActors()` via a **re-callable `fund()`** (so actors added later get funded too).
- **Actor handlers** (`function piece_action(...) external asActor`): one per natural user interaction, **faithful on the dynamic** (e.g. constant-product price impact on `swap`; utilization→rate on `borrow`/`accrue`; a real liquidation trigger). Mock the rest.
- **Admin/config handlers** (`function piece_setX(...) external asAdmin`): expose the integration's IMPORTANT admin/config setters (fee on/off, rate/IRM params, LLTV, oracle price, fee tier, pause). These let the fuzzer change the integration's config mid-run, which perturbs X's economics. Mock the auth (deployer-gated via `asAdmin`); don't model governance. See the per-class admin knobs in `references/behaviors-catalog.md`.
  - **Prefer a fuzzable `asAdmin` handler** (one piece covers many configs — the fuzzer flips fees, changes params live). **Fallback:** only when a setting must be FIXED at deploy (can't be toggled live) ship separate scenario variants/entries (e.g. `VaultMock_noFee` vs `VaultMock_2pctFee`). That's the exception, not the default.
- `forge build` must pass.
- See `references/behaviors-catalog.md` for the exact dynamics + admin knobs + the Morpho/Uniswap sketches below.

### 4. Declare labels (entry-name-prefixed)
**Prefix every label with your entry name** — `rvm.register("<EntryName>.<label>", addr)` (e.g. `MorphoMock.market`, `MorphoMock.loanToken`). The operator's `getAddr` namespace is **shared** by the SUT suite and every pulled piece, so a bare `"market"`/`"pool"`/`"token"` would collide. (Plain strings — no engine change; the dot is convention and does NOT clash with `loadVar` dot-paths, a different mechanism.) List the full prefixed labels in `recon-registry.toml` `labels = [...]` (persisted into the entry) — that's the contract with X's suite, which resolves via `getAddr("<EntryName>.<label>")`.

### 5. Pack
```bash
npx recon-registry pack     # forge build + extract → recon-registry-out/<name>.json (bytecode+abi+source+solc)
```

### 6. Validate
Schema-valid; the CI gate is **bytecode == recompile(source, solc)** (reproducibility) + a smoke deploy. Make sure `source` is inlined and `solc` matches.

### 7. Publish
```bash
npx recon-registry publish  # opens a PR; on merge it's live + deployable by name
```

## Anti-patterns
- **Don't deploy the real protocol in full.** Model the touched surface; mock the rest. If the real thing won't embed in one constructor, that's the signal to mock it, not to give up.
- **Don't test the integration's invariants.** No `Asserts`/ghosts/properties in a piece — X's suite owns invariants.
- **Don't add `deps/` beyond `Rvm` + `IERC20`.** Keep `asActor`/`asAdmin` inlined.
- **Don't hardcode users/addresses.** Pull actors via `rvm.getActors()`; wire by label.
- **Don't skip faithfulness on the dynamic that matters.** A swap with no price impact, or a market with a static rate, won't perturb X — the whole point is the *evolving* condition.
- **Don't use bare labels, and don't forget to declare them.** Prefix with the entry name (`"MorphoMock.market"`) — the `getAddr` namespace is shared, so bare labels collide with the suite's or other pieces'. Undeclared labels mean no suite can wire to your piece.

## References
- `references/model.md` — the behavioral-mock model + rationale.
- `references/behaviors-catalog.md` — per-class dynamics + edge cases to model (lending, AMM, CDP, vault, oracle).
- `references/registry-cli.md` — entry schema, `init`/`pack`/`publish`, the reproducibility gate.
- `references/wiring-into-operator.md` — how the piece plugs into an operator suite (cross-ref the operator-prove skill).
</content>
