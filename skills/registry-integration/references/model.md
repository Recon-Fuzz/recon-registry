# The behavioral-mock model

## The problem
You're fuzzing project **X**. X integrates with third-party protocols (Morpho, Uniswap, Liquity, an ERC4626 vault, an oracle). Those are audited; they are **not** your system under test. But X's behavior — and X's bugs — depend on how those integrations *behave*: a price that moves, a rate that spikes, a vault share price that drifts, a position that gets liquidated. To fuzz X meaningfully, the integration must be **live and behaving naturally** while actors and X interact with it.

A registry **piece** provides exactly that, and nothing more.

## What a piece is
**One self-contained contract** that mimics an integration's *natural behavior*, scoped to what X touches:

1. **Focused surface.** Implement only the entry points X calls. Everything else is mocked, stubbed, or omitted. You are not re-deploying the protocol — you are reproducing the slice of it X depends on.
2. **Faithful dynamics.** The behaviors that determine X's correctness must be realistic: price impact, interest accrual, rounding *direction*, liquidation triggers, utilization curves, share-price drift. A static mock that never moves teaches X nothing.
3. **Actor handlers.** `external … asActor` functions for the natural user actions (swap, supply/borrow/repay, add/remove liquidity, liquidate). The operator registers these as fuzz actions; the fuzzer drives them interleaved with X's actions, so X meets evolving conditions.
4. **Label-wired.** The constructor `rvm.register`s the integration's entry points under documented labels; X's suite resolves them via `rvm.getAddr("...")`. No hardcoded addresses.

## What a piece is NOT
- **Not a full deployment.** If the real protocol can't embed in one constructor, that's the signal to model a focused mock — not to ship the whole thing.
- **Not an invariant test of the integration.** No `Asserts`, ghosts, or `property_*`. The integration is assumed correct; X's invariants live in X's suite. A piece *generates conditions*, it doesn't *judge* the integration.

## Shape & deps
- One contract; `new`'d deps embedded → a single self-contained creation-bytecode artifact.
- Deps: **`Rvm.sol` + `IERC20.sol` only.** `asActor`/`asAdmin` are **inlined** modifiers (`startPrank(getActor())` / `startPrank(getActor("deployer"))`), not a base import.
- `constructor() asAdmin` deploys + registers + funds actors; no constructor args (pull actors via `rvm`).

## Why this is the right altitude
Too little (a dumb static mock) → X never sees realistic conditions; integration bugs in X stay hidden. Too much (the full real protocol + its own invariant tests) → unembeddable, slow, and off-mission (you'd be fuzzing the third party, not X). The behavioral mock is the minimum that makes X's cross-protocol paths *come alive*: faithful where it matters to X, mocked everywhere else.
</content>
