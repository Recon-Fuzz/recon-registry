# The behavioral-mock model

## The problem
You're fuzzing project **X**. X integrates with third-party protocols (Morpho, Uniswap, Liquity, an ERC4626 vault, an oracle). Those are audited; they are **not** your system under test. But X's behavior — and X's bugs — depend on how those integrations *behave*: a price that moves, a rate that spikes, a vault share price that drifts, a position that gets liquidated. To fuzz X meaningfully, the integration must be **live and behaving naturally** while actors and X interact with it.

A registry **piece** provides exactly that, and nothing more.

## What a piece is
**One self-contained contract** that mimics an integration's *natural behavior*, scoped to what X touches:

1. **Focused surface.** Implement only the entry points X calls. Everything else is mocked, stubbed, or omitted. You are not re-deploying the protocol — you are reproducing the slice of it X depends on.
2. **Faithful dynamics.** The behaviors that determine X's correctness must be realistic: price impact, interest accrual, rounding *direction*, liquidation triggers, utilization curves, share-price drift. A static mock that never moves teaches X nothing.
3. **Behaviors as plain external functions.** The natural user actions (swap, supply/borrow/repay, add/remove liquidity, liquidate) + adversarial knobs (set revert behaviour, set price, inflate shares). The operator auto-registers every mutating fn as a fuzz action and drives each with an actor — so they're just external functions; `asActor`/`asAdmin` only when caller identity matters (see Shape & deps).
4. **Label-wired.** The deployed contract is auto-registered under the entry name (`getAddr("<EntryName>")`); X resolves it there. If the piece deploys its own internal deps, it `rvm.register`s those under entry-name-prefixed labels. No hardcoded addresses.

## What a piece is NOT
- **Not a full deployment.** If the real protocol can't embed in one constructor, that's the signal to model a focused mock — not to ship the whole thing.
- **Not an invariant test of the integration.** No `Asserts`, ghosts, or `property_*`. The integration is assumed correct; X's invariants live in X's suite. A piece *generates conditions*, it doesn't *judge* the integration.

## Shape & deps
- One contract; any `new`'d helper deps embedded → a single self-contained creation-bytecode artifact.
- **Imports: whatever makes it a faithful mock** — OpenZeppelin, the protocol's own libraries, inheritance. The ONE hard rule: **never import the operator suite framework** (`BaseTargets`/`Asserts`/ghosts/`property_*`). `Rvm.sol`/`IERC20.sol` are available but **optional** (most pure mocks need neither).
- **The constructor takes its deps as ARGS** — the asset/token/oracle the consumer chooses is passed at deploy (`deployFromRegistry(name, abi.encode(asset))`). Don't fabricate consumer-chosen deps (`rvm.getAsset()` / a self-minted underlying); fabricate only state the consumer never controls.
- **`asActor`/`asAdmin` are OPTIONAL.** When deployed via `deploy_from_registry` the operator auto-registers each mutating fn as an action, drives it with an actor as `msg.sender`, registers the address under the entry name, and funds actors — so a plain mock needs no modifiers, no `rvm`, no `fund()`, no self-register. Add `asAdmin` (deployer-gated) only for a config setter you want gated; `asActor` only when a handler must keep one consistent caller across several calls.
- **Already have a faithful mock?** Packaging it *is* the port — don't wrap or reimplement it.

## Why this is the right altitude
Too little (a dumb static mock) → X never sees realistic conditions; integration bugs in X stay hidden. Too much (the full real protocol + its own invariant tests) → unembeddable, slow, and off-mission (you'd be fuzzing the third party, not X). The behavioral mock is the minimum that makes X's cross-protocol paths *come alive*: faithful where it matters to X, mocked everywhere else.
</content>
