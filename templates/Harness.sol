// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// A registry piece is ONE self-contained, deployable contract that reproduces a third-party
// integration's BEHAVIOR (including how it misbehaves) so the project being fuzzed (X) meets
// realistic, evolving cross-protocol conditions. It is NOT a full protocol deploy and NOT a test of
// the integration's own soundness — it may be deliberately adversarial.
//
// THIS FILE IS JUST A STARTING POINT — the shape is YOURS to decide. There is no mandatory layout.
//   • Already have a faithful mock (an ERC4626 tester, a mock oracle, …)? Don't rewrite it here —
//     point recon-registry.toml's `source`/`harness` at it (it can stay in src/) and delete this file.
//   • Writing one? Make it whatever a faithful mock needs: inherit OpenZeppelin / the protocol's own
//     code, `new` internal helpers — all of it embeds in the creation bytecode. The ONE hard rule:
//     do NOT import the operator suite framework (BaseTargets/Asserts/ghosts/property_*).
//
// CONSTRUCTOR TAKES ITS DEPENDENCIES AS ARGS. The asset/token/oracle/pool addresses the piece wires
// to are passed in by the consumer at deploy time — `deployFromRegistry("MyPiece", abi.encode(asset))`.
// Do NOT fabricate deps the consumer should choose (no rvm.getAsset(), no `new MyOwnToken()` for the
// underlying); let X pick the asset the integration runs against.
//
// JUST EXPOSE THE BEHAVIORS as plain external functions. When deployed via deploy_from_registry the
// operator auto-registers every mutating function as a fuzz action, drives each with an actor as
// msg.sender, registers the deployed address under the entry's label, and funds the actors — so you
// usually need NO rvm import, NO asActor/asAdmin, NO fund() loop, NO self-registration.
//
// The Rvm.sol / IERC20.sol siblings are here ONLY if you want them (see the OPTIONAL block below).
// Most pure mocks don't. Rename this contract (or replace the whole file).

// import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol"; // e.g.

contract MyIntegration /* is ERC4626 / IPool / ... */ {
    // Deps come in as constructor args — the consumer wires real addresses:
    constructor(/* address _asset, address _oracle, ... */) {
        // set up minimal initial state so X's calls succeed (seed reserves, create a market, …)
    }

    // Expose the behaviors X depends on — faithful on what matters, adversarial where the real thing
    // can be (revert quirks, rounding direction, price moves, unbacked inflation). No modifiers needed.
    //
    // function deposit(uint256 assets, address receiver) external returns (uint256) { ... }
    // function swap(uint256 amountIn, bool zeroForOne) external { /* faithful price impact */ }
    // function setPrice(uint256 p) external { /* move the stubbed oracle under X */ }

    // ---------------------------------------------------------------------------------------------
    // OPTIONAL — only if a function must run as a specific identity (e.g. a deployer-gated config
    // knob, or a multi-call handler that must keep one consistent caller). Most pieces don't need it.
    // ---------------------------------------------------------------------------------------------
    // import {rvm} from "./Rvm.sol";
    // modifier asActor() { rvm.startPrank(rvm.getActor()); _; rvm.stopPrank(); }
    // modifier asAdmin() { rvm.startPrank(rvm.getActor("deployer")); _; rvm.stopPrank(); }
    //
    // If you register additional internal addresses yourself, PREFIX the label with the entry name
    // (the getAddr namespace is shared, so bare labels collide):
    //   rvm.register("MyIntegration.pool", address(this));
}
