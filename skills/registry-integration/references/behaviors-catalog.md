# Behaviors catalog — what to model faithfully, per integration class

For each class: the **dynamics to model faithfully** (because X's correctness depends on them), the **edge cases** a dependent breaks on, what you can safely **stub/omit**, and the **admin knobs** to expose. Pick only what X touches, and **match the integration's real token decimals** (USDC=6, WBTC=8 — not a blind 18; rounding/price tests depend on it).

Each class lists handlers in two flavors: **actor** (`asActor` — natural user churn) and **admin/config** (`asAdmin` — important config the protocol's admin can change, e.g. fees/params/pause/price). Admin changes shift X's economics, so expose them as fuzzable `asAdmin` handlers — **authorize the deployer, mock the auth** (deployer-gated via the `asAdmin` modifier; do NOT model governance/roles/timelocks). Prefer a live `asAdmin` setter (one piece, many configs); ship a separate scenario variant ONLY for a **structural** choice baked in at deploy (token decimals, fee-on-transfer on/off, a different market topology) — never for anything a setter can toggle live.

> ⚠️ **The published `entries/MockERC4626Tester.json` is a LEGACY standalone tester — it PREDATES this model** (it takes a constructor arg, has no `rvm.register`/`asActor`/`asAdmin`/handlers, imports full OpenZeppelin). **Do NOT copy it.** The two worked sketches below (and the oracle sketch) are the canonical behavioral-piece exemplars — follow those.

> **Label rule (shared namespace):** every label a piece registers MUST be **prefixed with the entry name** — `rvm.register("MorphoMock.market", addr)`. The operator's `getAddr` namespace is shared by the SUT suite + all pulled pieces, so bare `"market"`/`"pool"`/`"token"` collide. Consumers resolve the prefixed form: `getAddr("MorphoMock.market")`. (The sketches below name their contracts `LendingMock`/`AmmMock`/`OracleMock` and prefix accordingly.)

## AMM / DEX (Uniswap, Curve, Balancer…)
- **Faithful:** price impact (constant-product `x*y=k` or the curve X relies on), the actual reserves/spot price X reads, fees, LP share math if X provides liquidity.
- **Edge cases:** large swap → big slippage, near-zero liquidity, price crossing a threshold X cares about, swap then immediate read (sandwich), rounding on `amountOut`.
- **Stub/omit:** factory/registry, TWAP oracle machinery (unless X reads it), flash-swap callbacks (unless X is the recipient), multi-hop routing, protocol fees toggles.
- **Actor handlers (`asActor`):** `swap(amountIn, zeroForOne)`, `addLiquidity(amt)`, `removeLiquidity(shares)`.
- **Admin/config (`asAdmin`):** `setFee(bps)` / fee-tier, `pause(bool)` — a fee change shifts X's swap economics.

## Lending / money market (Morpho, Aave, Compound…)
- **Faithful:** utilization → borrow/supply rate, interest accrual over time, the health-factor / LTV check that gates borrow + triggers liquidation, available liquidity (can X withdraw?).
- **Edge cases:** 100% utilization (withdraw blocked), accrual making a position liquidatable, partial liquidation, bad debt (collateral < debt), first supplier, dust positions.
- **Stub/omit:** the real IRM contract (inline a simple utilization→rate curve), the real oracle (use a settable price), governance/reward modules, e-mode/isolation tiers X doesn't use.
- **Actor handlers (`asActor`):** `supply`, `withdraw`, `borrow`, `repay`, `liquidate(victim)`. (`accrue()` is a permissionless poke — leave it plain `public`, no `asActor`: it takes no actor-specific action. Same for any `public` "anyone can poke" function.)
- **Admin/config (`asAdmin`):** `setFee(bps)`, `setRateParams(...)`/IRM knobs, `setLLTV(bps)` + liquidation params, `setPrice(p)` (stubbed oracle), `pause(bool)` — each reshapes X's rates/solvency mid-run.

## CDP / stablecoin (Liquity, MakerDAO…)
- **Faithful:** collateral ratio → liquidation, redemption mechanics if X depends on them, debt + the stable token's supply changes, the price feed X reads.
- **Edge cases:** trove just below MCR → liquidation, redemption hitting the riskiest trove, recovery mode, the seed/last trove.
- **Stub/omit:** sorted-troves data structure (a simple list/mapping is fine), gas-compensation niceties, governance.
- **Actor handlers (`asActor`):** `openTrove`, `adjustTrove`, `closeTrove`, `provideToSP`, `liquidate`.
- **Admin/config (`asAdmin`):** `setPrice(p)` (collateral feed), `setBorrowRate`/redemption params, recovery-mode threshold — move the price/params to trigger liquidations/redemptions X feels.

## Vault / yield (ERC4626, strategies…)
- **Faithful:** share price = assets/shares with the correct **rounding direction** (deposit floors shares, withdraw floors assets), yield/loss that drifts the share price, `convertToShares`/`convertToAssets`.
- **Edge cases:** share-inflation / donation attack (first depositor + direct asset transfer), zero-assets/zero-shares, rounding to zero, a loss event.
- **Stub/omit:** the real strategy/allocation logic (model net yield as a settable/accruing delta), fees unless X depends on them.
- **Actor handlers (`asActor`):** `deposit`, `withdraw`, `mint`, `redeem`, `accrueYield(delta)` (positive or negative).
- **Admin/config (`asAdmin`):** `setFee(bps)`, `setCap(amount)`, `pause(bool)` — a fee/cap change alters what X gets back.

## Oracle / price feed
- **Faithful:** the value + decimals + staleness/round fields X reads.
- **Edge cases:** stale timestamp, zero/negative price, extreme price (×100, ÷100), round-not-complete, decimals mismatch.
- **Stub/omit:** aggregation, multiple feeds, off-chain machinery.
- **Admin/config (`asAdmin`):** `setPrice(p)`, `setStale(bool)`, `setDecimals(d)` — the feed *is* config; let the fuzzer move/break it under X. (An oracle piece is essentially all admin/config knobs — no natural-user actions.)

## Token (ERC20 — when X integrates a *weird* token)
- **Faithful:** the weird behavior X must tolerate: fee-on-transfer, rebasing, missing/`false` return, non-18 decimals, blocklist.
- **Actor handlers:** usually none needed beyond the weirdness toggles; X drives transfers.

---

# Worked sketch 1 — Morpho-style lending mock (focused)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {rvm} from "./Rvm.sol";
import {IERC20} from "./IERC20.sol";

/// Behavioral mock of a single lending market X borrows/supplies against.
/// Faithful: utilization→rate, accrual, the LTV gate + liquidation. Stubbed: real IRM, oracle (settable),
/// rewards, governance. Registers (entry-name-prefixed): "LendingMock.lending", "LendingMock.loanToken", "LendingMock.collToken".
contract LendingMock {
    modifier asActor() { rvm.startPrank(rvm.getActor()); _; rvm.stopPrank(); }
    modifier asAdmin() { rvm.startPrank(rvm.getActor("deployer")); _; rvm.stopPrank(); }

    IERC20 public loanToken;     // a MockERC20 you new() — embedded
    IERC20 public collToken;
    uint256 public totalSupplied;
    uint256 public totalBorrowed;
    uint256 public price = 1e18; // collateral price, settable (stubbed oracle)
    uint256 public lastAccrue;
    uint256 public lltv = 0.8e18;   // settable liquidation LTV (admin/config knob)
    uint256 public feeBps;          // borrow fee (admin/config knob; 0 by default)
    mapping(address => uint256) public supplied;
    mapping(address => uint256) public borrowed;
    mapping(address => uint256) public collateral;

    constructor() asAdmin {
        loanToken = IERC20(address(new Mock20("Loan","LOAN",18)));
        collToken = IERC20(address(new Mock20("Coll","COLL",18)));
        lastAccrue = block.timestamp;
        rvm.register("LendingMock.lending", address(this));
        rvm.register("LendingMock.loanToken", address(loanToken));
        rvm.register("LendingMock.collToken", address(collToken));
        fund();   // mint + approve all actors
    }

    /// Re-callable so actors added AFTER deploy (`addActor`) get funded too — call it again then.
    function fund() public {
        address[] memory us = rvm.getActors();
        for (uint256 i; i < us.length; i++) {
            Mock20(address(loanToken)).mint(us[i], 1e30);
            Mock20(address(collToken)).mint(us[i], 1e30);
            rvm.prank(us[i]); loanToken.approve(address(this), type(uint256).max);
            rvm.prank(us[i]); collToken.approve(address(this), type(uint256).max);
        }
    }

    // faithful: utilization → per-second rate, simple-interest accrual (good enough to perturb X)
    function _rate() internal view returns (uint256) {
        uint256 u = totalSupplied == 0 ? 0 : (totalBorrowed * 1e18) / totalSupplied;
        return u / 1e9;                              // higher utilization → higher rate
    }
    function accrue() public {
        uint256 dt = block.timestamp - lastAccrue;
        if (dt > 0 && totalBorrowed > 0) {
            uint256 interest = (totalBorrowed * _rate() * dt) / 1e18;
            totalBorrowed += interest;               // X's debt grows over time
            lastAccrue = block.timestamp;
        }
    }
    function _healthy(address u) internal view returns (bool) {
        uint256 maxDebt = (collateral[u] * price / 1e18) * lltv / 1e18;
        return borrowed[u] <= maxDebt;
    }

    // --- actor handlers (natural churn that moves utilization/rate/liquidity) ---
    function supply(uint256 amt) external asActor { accrue(); loanToken.transferFrom(msg.sender, address(this), amt); supplied[msg.sender]+=amt; totalSupplied+=amt; }
    function addColl(uint256 amt) external asActor { collToken.transferFrom(msg.sender, address(this), amt); collateral[msg.sender]+=amt; }
    function borrow(uint256 amt) external asActor { accrue(); borrowed[msg.sender]+=amt; totalBorrowed+=amt; require(_healthy(msg.sender), "unhealthy"); require(totalBorrowed<=totalSupplied,"no liquidity"); loanToken.transfer(msg.sender, amt); }
    function repay(uint256 amt) external asActor { accrue(); loanToken.transferFrom(msg.sender, address(this), amt); borrowed[msg.sender]-=amt; totalBorrowed-=amt; }
    function liquidate(address v) external asActor { accrue(); require(!_healthy(v), "healthy"); uint256 seize=collateral[v]; collateral[v]=0; borrowed[v]=0; collToken.transfer(msg.sender, seize); } // simplified
    // --- admin/config handlers (asAdmin = deployer-gated; auth is MOCKED, not real governance) ---
    // The fuzzer flips these mid-run; each reshapes X's economics/solvency.
    function setPrice(uint256 p) external asAdmin { price = p; }   // stubbed oracle
    function setLLTV(uint256 b) external asAdmin { lltv = b; }     // tightening LLTV can make X's position liquidatable
    function setFee(uint256 b)  external asAdmin { feeBps = b; }   // a borrow fee shifts X's cost of capital
}

contract Mock20 is IERC20 {  // minimal embedded token (omitted: events, exhaustive checks)
    string public name; string public symbol; uint8 public decimals; uint256 public totalSupply;
    mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    constructor(string memory n,string memory s,uint8 d){name=n;symbol=s;decimals=d;}
    function mint(address t,uint256 a) external {balanceOf[t]+=a;totalSupply+=a;}
    function transfer(address t,uint256 a) external returns(bool){balanceOf[msg.sender]-=a;balanceOf[t]+=a;return true;}
    function transferFrom(address f,address t,uint256 a) external returns(bool){if(allowance[f][msg.sender]!=type(uint256).max)allowance[f][msg.sender]-=a;balanceOf[f]-=a;balanceOf[t]+=a;return true;}
    function approve(address s,uint256 a) external returns(bool){allowance[msg.sender][s]=a;return true;}
}
```
X resolves `getAddr("LendingMock.lending")` and borrows/supplies; meanwhile actors drive `supply`/`borrow`/`accrue`/`setPrice`/`liquidate`, so X faces shifting rates, tight liquidity, and liquidations — the conditions its bugs hide behind.

# Worked sketch 2 — Uniswap-style AMM mock (focused)

```solidity
/// Constant-product pool X prices/trades against. Faithful: x*y=k price impact + fee. Stubbed: factory,
/// TWAP, routing, flash callbacks. Registers (entry-name-prefixed): "AmmMock.pool", "AmmMock.token0", "AmmMock.token1".
contract AmmMock {
    modifier asActor() { rvm.startPrank(rvm.getActor()); _; rvm.stopPrank(); }
    modifier asAdmin() { rvm.startPrank(rvm.getActor("deployer")); _; rvm.stopPrank(); }
    IERC20 public token0; IERC20 public token1; uint256 public r0; uint256 public r1;
    uint256 public feeBps = 997; // 0.3% kept (admin/config knob; lower = more fee)

    constructor() asAdmin {
        token0 = IERC20(address(new Mock20("T0","T0",18)));
        token1 = IERC20(address(new Mock20("T1","T1",18)));
        Mock20(address(token0)).mint(address(this), 1e24); Mock20(address(token1)).mint(address(this), 1e24);
        r0 = 1e24; r1 = 1e24;                              // seed liquidity so swaps work + price is defined
        rvm.register("AmmMock.pool", address(this)); rvm.register("AmmMock.token0", address(token0)); rvm.register("AmmMock.token1", address(token1));
        fund();   // mint + approve all actors
    }
    /// Re-callable for actors added after deploy (`addActor`).
    function fund() public {
        address[] memory us = rvm.getActors();
        for (uint256 i; i < us.length; i++) {
            Mock20(address(token0)).mint(us[i], 1e24); Mock20(address(token1)).mint(us[i], 1e24);
            rvm.prank(us[i]); token0.approve(address(this), type(uint256).max);
            rvm.prank(us[i]); token1.approve(address(this), type(uint256).max);
        }
    }
    function spotPrice() external view returns (uint256) { return r1 * 1e18 / r0; } // what X reads

    // faithful constant-product swap → real price impact that X's accounting/pricing must survive
    function swap(uint256 amountIn, bool zeroForOne) external asActor {
        (IERC20 tin, IERC20 tout, uint256 rin, uint256 rout) = zeroForOne ? (token0,token1,r0,r1) : (token1,token0,r1,r0);
        tin.transferFrom(msg.sender, address(this), amountIn);
        uint256 inWithFee = amountIn * feeBps / 1000;
        uint256 out = (rout * inWithFee) / (rin + inWithFee);   // x*y=k
        if (zeroForOne) { r0 += amountIn; r1 -= out; } else { r1 += amountIn; r0 -= out; }
        tout.transfer(msg.sender, out);
    }
    function addLiquidity(uint256 a0, uint256 a1) external asActor { token0.transferFrom(msg.sender,address(this),a0); token1.transferFrom(msg.sender,address(this),a1); r0+=a0; r1+=a1; }
    // admin/config (mocked auth): the fuzzer changes the fee mid-run → shifts X's swap economics
    function setFee(uint256 keptBps) external asAdmin { require(keptBps <= 1000); feeBps = keptBps; }
}
```
X reads `spotPrice()` / trades via `getAddr("AmmMock.pool")`; actors `swap` to move the price organically (and the fuzzer can drive a swap → X-read sequence), exposing X's slippage/oracle/accounting assumptions.

# Worked sketch 3 — Chainlink-style oracle mock (all admin/config)

The read path **must match the real ABI exactly** or X won't decode it. A Chainlink consumer calls `latestRoundData()` and expects the exact 5-tuple `(roundId, answer, startedAt, updatedAt, answeredInRound)` plus `decimals()` — get the shape + decimals right; the price/staleness are the knobs.

```solidity
/// Settable price feed X reads. No natural-user actions — it's all admin/config. Registers: "OracleMock.oracle".
contract OracleMock {
    modifier asAdmin() { rvm.startPrank(rvm.getActor("deployer")); _; rvm.stopPrank(); }
    int256  public answer   = 2000e8;   // price, settable
    uint8   public dec      = 8;        // MATCH the real feed's decimals (Chainlink USD feeds = 8)
    uint80  public round    = 1;
    uint256 public updatedAt;           // settable to force staleness

    constructor() asAdmin { updatedAt = block.timestamp; rvm.register("OracleMock.oracle", address(this)); }

    function decimals() external view returns (uint8) { return dec; }
    // EXACT Chainlink return shape — X decodes all five fields
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, updatedAt, updatedAt, round);
    }

    // admin/config knobs (mocked auth) — the fuzzer moves/breaks the feed under X
    function setPrice(int256 p) external asAdmin { answer = p; round++; updatedAt = block.timestamp; } // incl. 0 / negative / extreme
    function setStale(uint256 ts) external asAdmin { updatedAt = ts; }   // force a stale read
    function setDecimals(uint8 d) external asAdmin { dec = d; }
}
```
X reads `IAggregator(rvm.getAddr("OracleMock.oracle")).latestRoundData()`; the fuzzer drives `setPrice` (including 0/negative/extreme) and `setStale`, exposing how X handles bad/stale prices.
</content>
