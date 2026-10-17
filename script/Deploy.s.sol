// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fogline} from "../src/Fogline.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {FoglineCosmetics} from "../src/FoglineCosmetics.sol";

/// Deploys the game, a valueless test token and the cosmetics shop.
/// TESTNET / LOCAL ONLY: refuses to run on any other chain.
contract Deploy is Script {
    function run() external {
        require(block.chainid == 84532 || block.chainid == 31337, "Fogline: testnet/local only (Base Sepolia 84532 or 31337)");
        address treasury = vm.envOr("TREASURY", msg.sender);
        vm.startBroadcast();
        MockUSDC usd = new MockUSDC();
        Fogline game = new Fogline();
        FoglineCosmetics shop = new FoglineCosmetics(address(usd), treasury, "https://tapelog-journal.github.io/fogline/cosmetics/{id}.json");
        shop.addItem("Tape Neon pieces", FoglineCosmetics.Kind.PieceSkin, 2e6, 0);
        shop.addItem("Candle Glow pieces", FoglineCosmetics.Kind.PieceSkin, 3e6, 500);
        shop.addItem("Midnight Fog board", FoglineCosmetics.Kind.BoardTheme, 1e6, 0);
        shop.addItem("Paper Ledger board", FoglineCosmetics.Kind.BoardTheme, 1e6, 0);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "token", address(usd));
        vm.serializeAddress(o, "cosmetics", address(shop));
        string memory json = vm.serializeAddress(o, "game", address(game));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console.log("Fogline", address(game));
        console.log("MockUSDC", address(usd));
        console.log("Cosmetics", address(shop));
    }
}
