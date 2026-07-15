// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console2} from "forge-std/Script.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafe {
    function setup(
        address[] memory _owners,
        uint256 _threshold,
        address to,
        bytes memory data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address paymentReceiver
    ) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function VERSION() external view returns (string memory);
}

/// @title CreateSafe — canonical Safe v1.4.1 deployment through Foundry wallet signing
/// @notice Creates the 2-of-4 treasury Safe without requiring any private key inside Solidity,
///         repo env files, or Codex-visible command input. The deployer is the public
///         `DEPLOYER_ADDRESS`; signing is delegated to Foundry CLI wallet options
///         (`--account`, `--ledger`, `--trezor`, `--unlocked`, etc.).
contract CreateSafe is Script {
    address internal constant PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_L2_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    address internal constant ZERO = address(0);

    error MissingDeployerAddress();
    error InvalidOwnerSet();
    error InvalidThreshold(uint256 threshold, uint256 owners);
    error DuplicateOwner(address owner);
    error CanonicalSafeCodeMissing(address target);
    error SingletonVersionMismatch(string version);
    error OwnerReadbackMismatch();
    error ThresholdReadbackMismatch(uint256 expected, uint256 actual);

    function run() external {
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));
        if (deployer == ZERO) revert MissingDeployerAddress();

        address[] memory owners = vm.envAddress("OWNERS", ",");
        uint256 threshold = vm.envUint("THRESHOLD");
        uint256 saltNonce = vm.envOr("SALT_NONCE", uint256(block.timestamp));

        _validateOwners(owners, threshold);
        _assertCanonicalSafeSet();

        bytes memory initializer =
            abi.encodeCall(ISafe.setup, (owners, threshold, ZERO, bytes(""), FALLBACK_HANDLER, ZERO, 0, ZERO));

        vm.startBroadcast(deployer);
        address safe = ISafeProxyFactory(PROXY_FACTORY).createProxyWithNonce(SAFE_L2_SINGLETON, initializer, saltNonce);
        vm.stopBroadcast();

        _assertReadback(safe, owners, threshold);

        console2.log("[safe:create] deployer:", deployer);
        console2.log("[safe:create] threshold:", threshold);
        console2.log("[safe:create] saltNonce:", saltNonce);
        console2.log("[safe:create] SAFE_ADDRESS=", safe);
    }

    function _validateOwners(address[] memory owners, uint256 threshold) internal pure {
        if (owners.length == 0) revert InvalidOwnerSet();
        if (threshold == 0 || threshold > owners.length) revert InvalidThreshold(threshold, owners.length);
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == ZERO) revert InvalidOwnerSet();
            for (uint256 j = i + 1; j < owners.length; j++) {
                if (owners[i] == owners[j]) revert DuplicateOwner(owners[i]);
            }
        }
    }

    function _assertCanonicalSafeSet() internal view {
        if (PROXY_FACTORY.code.length == 0) revert CanonicalSafeCodeMissing(PROXY_FACTORY);
        if (SAFE_L2_SINGLETON.code.length == 0) revert CanonicalSafeCodeMissing(SAFE_L2_SINGLETON);
        if (FALLBACK_HANDLER.code.length == 0) revert CanonicalSafeCodeMissing(FALLBACK_HANDLER);

        string memory version = ISafe(SAFE_L2_SINGLETON).VERSION();
        if (keccak256(bytes(version)) != keccak256(bytes("1.4.1"))) revert SingletonVersionMismatch(version);
    }

    function _assertReadback(address safe, address[] memory expectedOwners, uint256 expectedThreshold) internal view {
        address[] memory actualOwners = ISafe(safe).getOwners();
        if (actualOwners.length != expectedOwners.length) revert OwnerReadbackMismatch();
        for (uint256 i = 0; i < expectedOwners.length; i++) {
            if (actualOwners[i] != expectedOwners[i]) revert OwnerReadbackMismatch();
        }

        uint256 actualThreshold = ISafe(safe).getThreshold();
        if (actualThreshold != expectedThreshold) {
            revert ThresholdReadbackMismatch(expectedThreshold, actualThreshold);
        }
    }
}
