// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {rvm} from "./Rvm.sol";
import {IERC20} from "./IERC20.sol";

/// BEHAVIORAL INTEGRATION MOCK — a registry "puzzle piece".
///
/// Purpose: make a third-party integration (a lending market, an AMM, a CDP, a vault, an oracle…)
/// BEHAVE the way it really would as actors use it, so the main project (X) being fuzzed meets
/// realistic, *evolving* cross-protocol conditions — and we observe the effect on X.
///
/// This is NOT a full deployment of the real protocol, and NOT for testing the integration's own
/// invariants. The rules:
///   1. Model ONLY the surface X actually touches (the few entry points X calls). Mock / stub /
///      omit everything else (internal math you don't depend on, governance, peripheral modules,
///      IRMs/oracles X never reads).
///   2. Be FAITHFUL on the behaviors that affect X — the dynamics a bug in X would hinge on:
///      interest accrual, price impact, rounding direction, liquidation triggers, utilization.
///   3. Provide ACTOR HANDLERS for natural churn — external fns, run as the current actor, that let
///      the fuzzer drive the integration the way real users would (swap, supply/borrow/repay,
///      add/remove liquidity, liquidate). That churn is what perturbs X.
///   4. ONE self-contained contract. Deps are `Rvm` + `IERC20` only; the asActor/asAdmin modifiers
///      are inlined below (no BaseTargets/Asserts/ghosts — X's invariants live in X's suite).
///   5. REGISTER your entry points by label, PREFIXED with this entry's name (the `getAddr` namespace
///      is shared with the suite + other pieces, so bare labels collide): `rvm.register("MyIntegration.pool", addr)`.
///      Declare the full labels in recon-registry.toml / README; X resolves `rvm.getAddr("MyIntegration.pool")`.
contract MyIntegration {
    // --- inlined actor/admin pranking (no external base) ---
    modifier asActor() { rvm.startPrank(rvm.getActor()); _; rvm.stopPrank(); }
    modifier asAdmin() { rvm.startPrank(rvm.getActor("deployer")); _; rvm.stopPrank(); }

    // TODO: state for the minimal surface you model (e.g. a token, pool reserves, a market).
    // IERC20 internal asset;

    /// Stand up the minimal integration + register it by label + fund/approve actors.
    constructor() asAdmin {
        // 1. Deploy ONLY what X touches (a focused mock of the integration's relevant surface):
        //    asset = IERC20(new SomeMockToken(...));
        //    ... set up minimal initial state so X's calls succeed (e.g. seed liquidity) ...

        // 2. Register the entry points X will resolve by label — PREFIX with the entry name (shared namespace!):
        //    rvm.register("MyIntegration.pool", address(this));
        //    rvm.register("MyIntegration.asset", address(asset));

        // 3. Fund + approve every actor (via a re-callable fund() so late-added actors get funded too):
        fund();
    }

    /// Re-callable: fund + approve every CURRENT actor (covers actors added after deploy via addActor).
    function fund() public {
        address[] memory actors = rvm.getActors();
        for (uint256 i; i < actors.length; i++) {
            address a = actors[i];
            // SomeMockToken(address(asset)).mint(a, type(uint96).max);
            // rvm.prank(a); asset.approve(address(this), type(uint256).max);
            a; // remove once used
        }
    }

    // --- ACTOR HANDLERS: natural user actions that churn the integration's state ---
    // One per realistic interaction. The operator registers these as fuzz actions when this piece
    // is deployed via `deploy_from_registry` (it auto-registers the functions as actions). Keep them
    // faithful on the dynamics that affect X; mock the rest.
    //
    // function pool_swap(uint256 amountIn, bool zeroForOne) external asActor {
    //     // faithful price impact (e.g. constant-product) so X's pricing/accounting feels real moves
    // }
    // function market_borrow(uint256 amount) external asActor { /* moves utilization → rate */ }
    // function market_repay(uint256 amount)  external asActor { /* ... */ }
    // function liquidate(address victim)      external asActor { /* triggers the liquidation path */ }

    // --- ADMIN/CONFIG HANDLERS: the integration's important config the fuzzer should flip ---
    // asAdmin = deployer-gated; the auth is MOCKED (no real governance/roles). These reshape X's
    // economics mid-run, so expose the ones that matter (fee, rate/IRM params, LLTV, price, pause).
    //
    // function market_setFee(uint256 bps) external asAdmin { /* a fee change shifts X's cost of capital */ }
    // function setPrice(uint256 p)        external asAdmin { /* move the stubbed oracle under X */ }
}
