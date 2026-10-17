// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FoglineCosmetics} from "../src/FoglineCosmetics.sol";

/// FUTURE USE. Cosmetics only (no wagering) on Base mainnet, priced in real USDC.
/// Refuses to run unless the owner has explicitly set ALLOW_MAINNET_COSMETICS=yes-owner-approved.
/// The Fogline game/wagering contract can never be deployed to mainnet (constructor guard).
contract DeployCosmeticsMainnet is Script {
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        require(block.chainid == 8453, "Base mainnet only");
        require(
            keccak256(bytes(vm.envOr("ALLOW_MAINNET_COSMETICS", string("")))) == keccak256("yes-owner-approved"),
            "Mainnet cosmetics not approved by owner"
        );
        address treasury = vm.envAddress("TREASURY");
        vm.startBroadcast();
        FoglineCosmetics shop = new FoglineCosmetics(BASE_USDC, treasury, "https://tapelog-journal.github.io/fogline/cosmetics/{id}.json");
        vm.stopBroadcast();
        console.log("Cosmetics", address(shop));
    }
}
