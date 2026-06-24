# Wiring a piece into an operator suite

A piece only matters when it's plugged into a suite that fuzzes **X**. Here's the full path (the operator side lives in the `operator-prove` skill; this is the registry-author's view of the contract).

## How it attaches
1. **Cache it:** `cache_registry_entry("LendingMock")` (or it's already published/built-in) — pulls the entry's bytecode/abi into the operator's local cache.
2. **Deploy it:** `deploy_from_registry("LendingMock", args)` — registry pieces are cached bytecode (NOT a project artifact), so this is the path, **not** `deploy_by_name`. Its `constructor() asAdmin` deploys the focused integration, `rvm.register`s the entry points by label, and funds/approves the actors; `deploy_from_registry` then **auto-registers the piece's functions as fuzz actions** (it returns `functions_added`/`actions_enabled`) — so the `asActor` handlers (`swap`/`borrow`/`accrue`/`liquidate`) **and** the `asAdmin` admin/config handlers (`setFee`/`setParams`/`pause`) join the surface. (For a *passive* dep with no handlers, the in-constructor `rvm.deployFromRegistry(...)` cheatcode is the alternative.)
3. **X's suite resolves the integration by label:** X's `*Targets` constructor does `lending = ILending(rvm.getAddr("LendingMock.lending"))` — wired with no hardcoded address (labels are entry-name-prefixed).
4. **Fuzz:** the operator interleaves **X's handlers** and the **piece's actor handlers**, so the integration's state evolves under natural churn while X acts against it. X's invariants (in X's suite) catch the bugs this surfaces.

## The contract between the piece and the suite
- **Labels.** The piece registers entry points under documented labels (`recon-registry.toml` `labels = [...]` + README). X's suite resolves exactly those. This is the *only* coupling — keep them stable, descriptive, and **entry-name-prefixed** (e.g. `"LendingMock.lending"`, `"AmmMock.pool"`): the operator's `getAddr` namespace is shared by the suite + every pulled piece, so bare labels would collide.
- **Funding.** The piece funds/approves `rvm.getActors()` for its own tokens, so actors can use the integration immediately — including actors added later (re-runnable funding is a plus).
- **No invariants.** The piece asserts nothing. If an interaction *should* fail (e.g. borrow beyond LTV), it `require`s/reverts naturally — a plain revert is benign to the operator (it just means that action failed), not a property break. X's suite decides what's a bug.

## Why this gives "the best of each world"
- X is fuzzed against an integration that **behaves like the real thing on the axes that matter** (price moves, rates drift, liquidations fire) — not a static stub that hides cross-protocol bugs.
- The piece is **reusable**: any project depending on that integration class pulls the same piece and wires by label. Author once, prove many.
- It's **cheap to compose**: stand up a realistic multi-protocol environment by naming the pieces and resolving labels, instead of hand-writing every mock per suite.

## See also
- `operator-prove` skill → its `registry.md` reference (the suite-side: `cache_registry_entry` → `deploy_from_registry` to deploy + wire a piece; the in-constructor `deployFromRegistry` cheatcode for passive deps).
- `references/behaviors-catalog.md` here for what to model so the churn is realistic.
</content>
