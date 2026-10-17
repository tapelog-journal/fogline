// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FoglineCosmetics} from "../src/FoglineCosmetics.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract FoglineCosmeticsTest is Test {
    FoglineCosmetics shop;
    MockUSDC usd;
    address treasury = makeAddr("treasury");
    address buyer = makeAddr("buyer");
    address minter = makeAddr("minter");

    function setUp() public {
        usd = new MockUSDC();
        shop = new FoglineCosmetics(address(usd), treasury, "https://example.invalid/{id}.json");
        shop.addItem("Neon Tape skin", FoglineCosmetics.Kind.PieceSkin, 2e6, 0);
        shop.addItem("Midnight board", FoglineCosmetics.Kind.BoardTheme, 1e6, 1);
        shop.setMinter(minter, true);
        vm.startPrank(buyer);
        usd.faucet();
        usd.approve(address(shop), type(uint256).max);
        vm.stopPrank();
    }

    function test_BuyMintsAndPaysTreasury() public {
        vm.prank(buyer);
        shop.buy(1, 2);
        assertEq(shop.balanceOf(buyer, 1), 2);
        assertEq(usd.balanceOf(treasury), 4e6);
    }

    function test_SoldOut() public {
        vm.prank(buyer);
        shop.buy(2, 1);
        vm.prank(buyer);
        vm.expectRevert(FoglineCosmetics.SoldOut.selector);
        shop.buy(2, 1);
    }

    function test_InactiveAndNotForSale() public {
        shop.updateItem(1, 0, true);
        vm.prank(buyer);
        vm.expectRevert(FoglineCosmetics.NotForSale.selector);
        shop.buy(1, 1);
        shop.updateItem(1, 2e6, false);
        vm.prank(buyer);
        vm.expectRevert(FoglineCosmetics.Inactive.selector);
        shop.buy(1, 1);
    }

    function test_MinterMintsForOffchainSale() public {
        vm.expectRevert(FoglineCosmetics.NotMinter.selector);
        shop.mintTo(buyer, 1, 1);
        vm.prank(minter);
        shop.mintTo(buyer, 1, 1);
        assertEq(shop.balanceOf(buyer, 1), 1);
        assertEq(usd.balanceOf(treasury), 0);
    }

    function test_OnlyOwnerAdmin() public {
        vm.prank(buyer);
        vm.expectRevert();
        shop.addItem("x", FoglineCosmetics.Kind.PieceSkin, 1, 0);
    }

    function test_EquipAndAutoUnequipOnTransfer() public {
        vm.prank(buyer);
        vm.expectRevert(FoglineCosmetics.NotOwned.selector);
        shop.equip(FoglineCosmetics.Kind.PieceSkin, 1);
        vm.startPrank(buyer);
        shop.buy(1, 1);
        vm.expectRevert(FoglineCosmetics.NotOwned.selector);
        shop.equip(FoglineCosmetics.Kind.BoardTheme, 1); // wrong slot
        shop.equip(FoglineCosmetics.Kind.PieceSkin, 1);
        assertEq(shop.equipped(buyer, FoglineCosmetics.Kind.PieceSkin), 1);
        shop.safeTransferFrom(buyer, treasury, 1, 1, "");
        vm.stopPrank();
        assertEq(shop.equipped(buyer, FoglineCosmetics.Kind.PieceSkin), 0);
    }
}
