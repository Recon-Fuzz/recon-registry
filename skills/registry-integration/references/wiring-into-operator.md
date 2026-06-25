# Wiring a piece into an operator suite

A piece only matters when it's plugged into a suite that fuzzes **X**. Here's the full path (the operator side lives in the `operator-prove` skill; this is the registry-author's view of the contract).

## How it attaches
1. **Cache it:** `cache_registry_entry("LendingMock")` (or it's already published/built-in) — pulls the entry's bytecode/abi into the operator's local cache.
2. **Deploy it:** `deploy_from_registry("LendingMock", args)` — registry pieces are cached bytecode (NOT a project artifact), so this is the path, **not** `deploy_by_name`. `args` are the constructor args the piece takes (the consumer-chosen asset/token/oracle, ABI-encoded). The operator **auto-registers every mutating function as a fuzz action** (returns `functions_added`/`actions_enabled`), **drives each with an actor as `msg.sender`, funds the actors, and registers the deployed address under the entry name** — so the behaviors (`swap`/`borrow`/`accrue`/`liquidate`, and adversarial knobs like `setFee`/`setPrice`/`setRevertBehaviour`) join the surface with no `asActor`/`asAdmin` needed unless caller identity matters. (For a *passive* dep, the in-constructor `rvm.deployFromRegistry(...)` cheatcode is the alternative.)
3. **X's suite resolves the integration by label:** X's `*Targets` constructor does `lending = ILending(rvm.getAddr("LendingMock"))` (the main contract, auto-registered under the entry name) — or an entry-name-prefixed internal label the piece registered (`getAddr("LendingMock.loanToken")`). No hardcoded addresses.
4. **Fuzz:** the operator interleaves **X's handlers** and the **piece's actor handlers**, so the integration's state evolves under natural churn while X acts against it. X's invariants (in X's suite) catch the bugs this surfaces.

## The contract between the piece and the suite
- **Labels.** X resolves the main contract via `getAddr("<EntryName>")` (auto-registered). Any **internal** address the piece deploys + registers itself is documented in `recon-registry.toml` `labels = [...]`, **entry-name-prefixed** (e.g. `"LendingMock.loanToken"`) — the `getAddr` namespace is shared by the suite + every pulled piece, so bare labels collide. A self-contained mock declares `labels = []`. Don't declare a label the piece doesn't actually register.
- **Funding & approvals.** The operator **mints** its mock assets to actors (+ gives them ETH). Actor→spender **allowances are NOT auto-granted at deploy** — they come from the built-in `asset_approve` fuzz action the fuzzer drives, or from X's suite in setup. So a piece using a **consumer-supplied operator asset** needs no piece-side funding. A piece that deploys **its own** tokens must mint + approve `rvm.getActors()` for those itself (re-runnable, so late-added actors are covered).
- **No invariants.** The piece asserts nothing. If an interaction *should* fail (e.g. borrow beyond LTV), it `require`s/reverts naturally — a plain revert is benign to the operator (it just means that action failed), not a property break. X's suite decides what's a bug.

## Why this gives "the best of each world"
- X is fuzzed against an integration that **behaves like the real thing on the axes that matter** (price moves, rates drift, liquidations fire) — not a static stub that hides cross-protocol bugs.
- The piece is **reusable**: any project depending on that integration class pulls the same piece and wires by label. Author once, prove many.
- It's **cheap to compose**: stand up a realistic multi-protocol environment by naming the pieces and resolving labels, instead of hand-writing every mock per suite.

## See also
- `operator-prove` skill → its `registry.md` reference (the suite-side: `cache_registry_entry` → `deploy_from_registry` to deploy + wire a piece; the in-constructor `deployFromRegistry` cheatcode for passive deps).
- `references/behaviors-catalog.md` here for what to model so the churn is realistic.
</content>
