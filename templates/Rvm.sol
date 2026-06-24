// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// slither-disable-start shadowing-local

/// Recon operator VM — a SELF-CONTAINED cheatcode interface (like chimera's `IHevm`).
///
/// Declares ONLY the cheatcodes the operator engine actually implements — it does NOT
/// `is Vm` / import forge-std. Inheriting forge-std's `Vm` would (a) advertise hundreds of
/// cheatcodes the operator does not serve (`ffi`, `env*`, `expectRevert`, `mockCall`,
/// snapshots, fs, …) so `rvm.X` compiles for things that silently do nothing at runtime, and
/// (b) drag a forge-std dependency into the vended framework. This interface mirrors the Rust
/// `sol!` block in `evm/src/cheatcodes.rs` 1:1, so every selector here is one the inspector
/// dispatches. The handle is `rvm` (NOT `vm`): a contract inheriting forge-std `Test`/a mock
/// helper already has a plain `Vm vm` in scope that would shadow an extended `vm` and strip
/// these additions — `rvm` is collision-free because nothing else declares it.
interface IRvm {
    // ===================================================================
    // Standard cheatcodes the operator supports (a curated subset of Foundry's Vm)
    // ===================================================================
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newNumber) external;
    function chainId(uint256 newChainId) external;
    function assume(bool condition) external pure;
    function deal(address who, uint256 newBalance) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function store(address target, bytes32 slot, bytes32 value) external;
    function etch(address target, bytes calldata code) external;
    function label(address account, string calldata newLabel) external;
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    /// Generate a deterministic batch of fuzzed calldata (operator dictionary-driven).
    function generateCalls(uint256 count) external returns (bytes[] memory);

    // ===================================================================
    // loadVar / storeVar — read & write storage by variable name or packed extraction
    // ===================================================================

    /// Read a variable by dot-separated path (e.g. "x", "config.fee", "nested.data.amount").
    function loadVar(address target, string calldata path) external returns (bytes32);
    /// Read a variable by path with ABI-encoded mapping/array keys.
    function loadVar(address target, string calldata path, bytes calldata keys) external returns (bytes32);
    /// Raw packed extraction: read `size` bytes at byte `offset` from `slot`.
    function loadVar(address target, bytes32 slot, uint8 offset, uint8 size) external returns (bytes32);

    /// Write a variable by dot-separated path.
    function storeVar(address target, string calldata path, bytes32 value) external;
    /// Write a variable by path with ABI-encoded mapping/array keys.
    function storeVar(address target, string calldata path, bytes calldata keys, bytes32 value) external;
    /// Raw packed write: write `size` bytes at byte `offset` in `slot`.
    function storeVar(address target, bytes32 slot, uint8 offset, uint8 size, bytes32 value) external;

    // ===================================================================
    // Storage layout registration
    // ===================================================================

    /// Register a storage layout (solc JSON or compact format).
    function registerStorageLayout(address target, string calldata layout_) external;
    /// Assign a compiled contract's layout to an address by name.
    function assignStorageLayout(address target, string calldata contractName) external;
    /// Register a namespaced layout (ERC-7201).
    function registerNamespace(address target, string calldata ns, string calldata layout_) external;
    /// Register a namespaced layout at a manual base slot.
    function registerNamespace(address target, uint256 baseSlot, string calldata layout_) external;

    // ===================================================================
    // Operator extensions — actors, assets, ghosts, generic registry
    // (Rust-backed; served by the operator's live campaign)
    // ===================================================================

    // --- Actors (the operator's actor set; LABEL-derived + signable) ---
    // Each actor is addr(label_to_pk(label)); the suite signs with pk = keccak(label).
    function getActor() external view returns (address);
    function getActor(string calldata label) external view returns (address);
    function getActors() external view returns (address[] memory);
    function addActor(string calldata label) external returns (address);
    function removeActor(string calldata label) external;
    function switchActor(uint256 entropy) external;
    // Universal label resolver: registered contract address, else addr(keccak(label)).
    function getAddr(string calldata label) external view returns (address);
    // Register a (CREATE-derived) deployed contract under a label so getAddr(label) resolves it.
    // Keccak-derived names resolve without this; use it for internals deployed via `new`.
    function register(string calldata label, address addr) external;
    // Operator-native op tracking (set by the engine per fuzzed action — no SelectorStorage/trackOp
    // codegen needed): selector + target of the action currently running, readable from properties.
    function currentOp() external view returns (bytes4);
    function currentTarget() external view returns (address);
    // Reverse of register: the label registered for `addr`, or "" if none.
    function getLabel(address addr) external view returns (string memory);

    // --- Assets (operator-managed mock-token registry) ---
    function getAsset() external view returns (address);
    function getAssets() external view returns (address[] memory);
    function newAsset(uint8 decimals) external returns (address); // auto-labeled "asset_N"
    function newAsset(string calldata label, uint8 decimals) external returns (address); // getAddr(label) resolves it
    function addAsset(address token) external;
    function removeAsset(address token) external;
    function switchAsset(uint256 entropy) external;

    // --- Ghosts (contracts snapshotted by trackOp + a bytes KV) ---
    function ghosts() external view returns (address[] memory);
    function ghostGet(string calldata key) external view returns (bytes memory);
    function ghostSet(string calldata key, bytes calldata value) external;

    // --- Generic named registry: indexed list of ABI-encoded values + a "current" pointer ---
    function push(string calldata name, bytes calldata item) external;
    function pop(string calldata name) external returns (bytes memory);
    function removeAt(string calldata name, uint256 index) external;
    function store(string calldata name, uint256 index, bytes calldata item) external;
    function pick(string calldata name, uint256 entropy) external returns (bytes memory);
    function current(string calldata name) external view returns (bytes memory);
    function at(string calldata name, uint256 index) external view returns (bytes memory);
    function all(string calldata name) external view returns (bytes[] memory);
    function count(string calldata name) external view returns (uint256);

    // --- Contract registry: deploy a CACHED entry by name (harness composition) ---
    /// Deploy a registry entry the operator has cached locally — does NOT fetch over the network
    /// (the operator caches it beforehand; reverts if uncached). `args` is the ABI-encoded
    /// constructor args. Returns the deployed address. Setup-time composition, e.g.:
    ///   address vault = rvm.deployFromRegistry("ERC4626Tester", abi.encode(asset));
    function deployFromRegistry(string calldata name, bytes calldata args) external returns (address);
}

// Global instance bound to the HEVM cheatcode address.
IRvm constant rvm = IRvm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

// slither-disable-end shadowing-local
