// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {rvm} from "./Rvm.sol";

// import {YourProtocol} from "src/YourProtocol.sol";
// import {MockToken}    from "src/mocks/MockToken.sol";

/// A registry harness packages an ENTIRE project into ONE self-contained contract: its
/// constructor `new`s and wires the whole protocol, funds the operator's actors, and sets up
/// initial state. Deploying this one artifact (the operator does so with `as_actor: true`)
/// stands the project up — `new`'d contracts are embedded in this harness's creation bytecode.
///
/// After deploy, you attach handlers / properties / ghosts at runtime; this harness is just the
/// SUT setup. Expose addresses via public getters so those can wire to them.
contract MyHarness {
    // YourProtocol public protocol;
    // MockToken public token;

    constructor() {
        // The operator's actor set (includes this harness when deployed as_actor).
        address[] memory actors = rvm.getActors();

        // 1. Deploy + wire your protocol and mocks here:
        // token = new MockToken("Test", "TST", 18);
        // protocol = new YourProtocol(address(token));

        // 2. Fund / approve every actor (no hardcoded users):
        for (uint256 i; i < actors.length; i++) {
            address a = actors[i];
            // token.mint(a, type(uint128).max);
            // rvm.prank(a); token.approve(address(protocol), type(uint256).max);
            a; // remove once used
        }
    }

    // function protocolAddr() external view returns (address) { return address(protocol); }
}
