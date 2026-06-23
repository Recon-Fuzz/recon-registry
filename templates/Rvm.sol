// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Vm} from "forge-std/Vm.sol";

/// Recon extended VM — inherits ALL Foundry cheatcodes (via `is Vm`) and adds the operator's
/// actor / asset / ghost / generic-registry extensions, served at the canonical cheatcode
/// address. The handle is named `rvm` so it never collides with forge-std's `vm`.
interface IRvm is Vm {
    // --- actors (the operator's actor set; includes the harness/deployer when deployed as_actor) ---
    function getActor() external view returns (address);
    function getActor(uint256 index) external view returns (address);
    function getActors() external view returns (address[] memory);
    function addActor() external returns (address);
    function addActor(address actor) external;
    function removeActor(address actor) external;
    function switchActor(uint256 entropy) external;

    // --- assets (operator-managed mock-token registry) ---
    function getAsset() external view returns (address);
    function getAssets() external view returns (address[] memory);
    function newAsset(uint8 decimals) external returns (address);
    function addAsset(address token) external;
    function switchAsset(uint256 entropy) external;

    // --- ghosts ---
    function ghosts() external view returns (address[] memory);
    function ghostGet(string calldata key) external view returns (bytes memory);
    function ghostSet(string calldata key, bytes calldata value) external;

    // --- generic named registry ---
    function push(string calldata name, bytes calldata item) external;
    function pop(string calldata name) external returns (bytes memory);
    function removeAt(string calldata name, uint256 index) external;
    function store(string calldata name, uint256 index, bytes calldata item) external;
    function pick(string calldata name, uint256 entropy) external returns (bytes memory);
    function current(string calldata name) external view returns (bytes memory);
    function at(string calldata name, uint256 index) external view returns (bytes memory);
    function all(string calldata name) external view returns (bytes[] memory);
    function count(string calldata name) external view returns (uint256);
}

/// Recon VM handle. `rvm.*` — distinct from forge-std's `vm`.
IRvm constant rvm = IRvm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
