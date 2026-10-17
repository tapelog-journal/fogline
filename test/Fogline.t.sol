// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fogline} from "../src/Fogline.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract FoglineTest is Test {
    Fogline game;
    MockUSDC usd;
    address alice = makeAddr("alice"); // side 0
    address bob = makeAddr("bob"); // side 1
    uint256 constant STAKE = 50e6;
    uint32 constant TO = 600;

    uint8 constant BEACON = 0;
    uint8 constant GHOST = 1;
    uint8 constant SCOUT = 2;
    uint8 constant SAPPER = 3;
    uint8 constant GUARD = 4;
    uint8 constant KNIGHT = 5;
    uint8 constant CAPTAIN = 6;
    uint8 constant WARDEN = 7;
    uint8 constant MINE = 8;

    function setUp() public {
        vm.chainId(31337);
        game = new Fogline();
        usd = new MockUSDC();
        vm.prank(alice);
        usd.faucet();
        vm.prank(bob);
        usd.faucet();
        vm.prank(alice);
        usd.approve(address(game), type(uint256).max);
        vm.prank(bob);
        usd.approve(address(game), type(uint256).max);
    }

    // side 0: row0 = back, row1 = front (indices 8..15)
    function layoutA() internal pure returns (uint8[16] memory r) {
        r = [MINE, BEACON, MINE, GUARD, CAPTAIN, WARDEN, SAPPER, GHOST, SCOUT, GUARD, KNIGHT, SCOUT, SAPPER, KNIGHT, GUARD, SCOUT];
    }

    // side 1: row6 = front (indices 0..7), row7 = back
    function layoutB() internal pure returns (uint8[16] memory r) {
        r = [SCOUT, GUARD, KNIGHT, SCOUT, SAPPER, KNIGHT, GUARD, SCOUT, MINE, BEACON, MINE, GUARD, CAPTAIN, WARDEN, SAPPER, GHOST];
    }

    // side 1 with the Beacon exposed on the front row at square 48
    function layoutBExposed() internal pure returns (uint8[16] memory r) {
        r = [BEACON, GUARD, KNIGHT, SCOUT, SAPPER, KNIGHT, GUARD, SCOUT, MINE, SCOUT, MINE, GUARD, CAPTAIN, WARDEN, SAPPER, GHOST];
    }

    function salt(address who, uint8 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", who, i));
    }

    function commits(uint256 id, address who, uint8[16] memory r) internal view returns (bytes32[16] memory c) {
        for (uint8 i = 0; i < 16; i++) c[i] = game.pieceCommitment(id, who, i, r[i], salt(who, i));
    }

    function salts(address who) internal pure returns (bytes32[16] memory s) {
        for (uint8 i = 0; i < 16; i++) s[i] = salt(who, i);
    }

    function startMatch(uint256 stake, uint8[16] memory ra, uint8[16] memory rb) internal returns (uint256 id) {
        vm.prank(alice);
        id = game.createMatch(stake > 0 ? address(usd) : address(0), stake, TO, address(0));
        vm.prank(bob);
        game.joinMatch(id);
        bytes32[16] memory c_alice_4072 = commits(id, alice, ra);
        vm.prank(alice);
        game.commitLayout(id, c_alice_4072);
        bytes32[16] memory c_bob_6081 = commits(id, bob, rb);
        vm.prank(bob);
        game.commitLayout(id, c_bob_6081);
    }

    // helpers: move with optional reveal
    function mv(uint256 id, address who, uint8 from, uint8 to, uint8 rank, uint8 idx) internal {
        vm.prank(who);
        game.move(id, from, to, rank, salt(who, idx));
    }

    function step(uint256 id, address who, uint8 from, uint8 to) internal {
        vm.prank(who);
        game.move(id, from, to, 0, bytes32(0));
    }

    // ---------------------------------------------------------------- tests

    function test_DeployGuardRefusesMainnet() public {
        vm.chainId(8453);
        vm.expectRevert(Fogline.WrongChain.selector);
        new Fogline();
        vm.chainId(1);
        vm.expectRevert(Fogline.WrongChain.selector);
        new Fogline();
        vm.chainId(84532);
        new Fogline();
    }

    function test_CreateJoinCommitEscrow() public {
        uint256 id = startMatch(STAKE, layoutA(), layoutB());
        Fogline.Match memory m = game.getMatch(id);
        assertEq(uint8(m.phase), uint8(Fogline.Phase.Playing));
        assertEq(usd.balanceOf(address(game)), 2 * STAKE);
        uint8[64] memory b = game.getBoard(id);
        assertEq(b[0], 1); // side0 piece 0
        assertEq(b[48], 17); // side1 piece 0
        assertEq(b[30], 0);
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertFalse(ps[0].revealed);
    }

    function test_CancelRefunds() public {
        vm.prank(alice);
        uint256 id = game.createMatch(address(usd), STAKE, TO, address(0));
        assertEq(usd.balanceOf(alice), 1000e6 - STAKE);
        vm.prank(alice);
        game.cancelMatch(id);
        assertEq(usd.balanceOf(alice), 1000e6);
    }

    function test_InviteOnlyMatch() public {
        vm.prank(alice);
        uint256 id = game.createMatch(address(0), 0, TO, bob);
        vm.prank(makeAddr("eve"));
        vm.expectRevert(Fogline.NotPlayer.selector);
        game.joinMatch(id);
        vm.prank(bob);
        game.joinMatch(id);
    }

    function test_NotYourTurnAndBadMoves() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        vm.expectRevert(Fogline.NotYourTurn.selector);
        step(id, bob, 48, 40);
        vm.expectRevert(Fogline.BadMove.selector);
        step(id, alice, 8, 17); // diagonal
        vm.expectRevert(Fogline.BadMove.selector);
        step(id, alice, 0, 8); // onto own piece
        vm.expectRevert(Fogline.BadSquare.selector);
        step(id, alice, 48, 40); // enemy piece
        // 2-square move by a Guard (idx 9 at sq 9) is illegal
        vm.expectRevert(Fogline.BadMove.selector);
        mv(id, alice, 9, 25, GUARD, 9);
        // claiming Scout for a Guard fails the commitment check
        vm.expectRevert(Fogline.BadReveal.selector);
        mv(id, alice, 9, 25, SCOUT, 9);
    }

    function test_FogBankBlocks() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        // Knight at square 10 (column 2) walks up and hits the fog bank at 26
        step(id, alice, 10, 18);
        step(id, bob, 55, 47);
        vm.expectRevert(Fogline.BadSquare.selector);
        step(id, alice, 18, 26);
    }

    function test_ScoutLongMoveRevealsItself() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        mv(id, alice, 11, 35, SCOUT, 11); // 3 squares up column 3
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertTrue(ps[11].revealed);
        assertEq(ps[11].rank, SCOUT);
        assertEq(game.getBoard(id)[35], 12);
    }

    function test_CombatRevealResolve() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        step(id, alice, 8, 16);
        step(id, bob, 49, 41);
        step(id, alice, 16, 24);
        step(id, bob, 41, 33);
        step(id, alice, 24, 32);
        // bob's Guard (side1 idx1) attacks alice's Scout at 32
        mv(id, bob, 33, 32, GUARD, 1);
        Fogline.Match memory m = game.getMatch(id);
        assertEq(uint8(m.phase), uint8(Fogline.Phase.PendingReveal));
        assertEq(m.turn, 0);
        // wrong salt fails
        vm.prank(alice);
        vm.expectRevert(Fogline.BadReveal.selector);
        game.revealDefense(id, SCOUT, bytes32("nope"));
        vm.prank(alice);
        game.revealDefense(id, SCOUT, salt(alice, 8));
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertFalse(ps[8].alive);
        assertTrue(ps[17].alive);
        assertEq(game.getBoard(id)[32], 18);
        assertEq(game.getBoard(id)[33], 0);
        m = game.getMatch(id);
        assertEq(m.turn, 0); // alice to move after resolution
        assertEq(uint8(m.phase), uint8(Fogline.Phase.Playing));
    }

    function test_AttackRevealedDefenderResolvesImmediately() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        mv(id, alice, 11, 35, SCOUT, 11); // revealed scout at 35
        step(id, bob, 51, 43); // bob scout idx3 col3 row6->row5
        step(id, alice, 9, 17);
        // bob attacks revealed scout at 35 from 43 with his scout (tie -> defender holds)
        mv(id, bob, 43, 35, SCOUT, 3);
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertFalse(ps[19].alive); // attacker removed
        assertTrue(ps[11].alive);
        assertEq(uint8(game.getMatch(id).phase), uint8(Fogline.Phase.Playing));
    }

    function test_CombatTable() public view {
        assertEq(game.combatOutcome(SCOUT, BEACON), 0);
        assertEq(game.combatOutcome(WARDEN, MINE), 2); // single-use mine
        assertEq(game.combatOutcome(SAPPER, MINE), 0); // defused
        assertEq(game.combatOutcome(GHOST, WARDEN), 0); // ambush
        assertEq(game.combatOutcome(WARDEN, GHOST), 0);
        assertEq(game.combatOutcome(GUARD, KNIGHT), 1);
        assertEq(game.combatOutcome(KNIGHT, GUARD), 0);
        assertEq(game.combatOutcome(GUARD, GUARD), 1); // defender holds ties
    }

    function _beaconWin(uint256 stake) internal returns (uint256 id) {
        id = startMatch(stake, layoutA(), layoutBExposed());
        mv(id, alice, 8, 32, SCOUT, 8); // 8 -> 32 (3 squares, col 0)
        step(id, bob, 49, 41);
        mv(id, alice, 32, 48, SCOUT, 8); // attack Beacon at 48 from 2 away
        vm.prank(bob);
        game.revealDefense(id, BEACON, salt(bob, 0));
    }

    function test_BeaconCaptureVerifyPayout() public {
        uint256 id = _beaconWin(STAKE);
        Fogline.Match memory m = game.getMatch(id);
        assertEq(uint8(m.phase), uint8(Fogline.Phase.Ended));
        assertEq(m.winner, 0);
        assertEq(uint8(m.reason), uint8(Fogline.EndReason.BeaconCaptured));
        // loser cannot verify for the winner
        vm.prank(bob);
        vm.expectRevert(Fogline.NotPlayer.selector);
        game.verifyLayout(id, layoutBExposed(), salts(bob));
        vm.prank(alice);
        game.verifyLayout(id, layoutA(), salts(alice));
        assertEq(usd.balanceOf(alice), 1000e6 + STAKE);
        assertEq(usd.balanceOf(bob), 1000e6 - STAKE);
        assertEq(usd.balanceOf(address(game)), 0);
        assertEq(uint8(game.getMatch(id).phase), uint8(Fogline.Phase.Settled));
    }

    function test_IllegalCompositionCannotCollect() public {
        // alice commits an army of 16 Scouts; she can still play but never verify
        uint8[16] memory cheat;
        for (uint8 i = 0; i < 16; i++) cheat[i] = SCOUT;
        uint256 id = startMatch(STAKE, cheat, layoutBExposed());
        mv(id, alice, 8, 32, SCOUT, 8);
        step(id, bob, 49, 41);
        mv(id, alice, 32, 48, SCOUT, 8);
        vm.prank(bob);
        game.revealDefense(id, BEACON, salt(bob, 0));
        vm.prank(alice);
        vm.expectRevert(Fogline.BadLayout.selector);
        game.verifyLayout(id, cheat, salts(alice));
        // after the window the honest side takes the pot
        vm.expectRevert(Fogline.NotExpired.selector);
        game.claimUnverified(id);
        vm.warp(block.timestamp + TO + 1);
        game.claimUnverified(id);
        assertEq(usd.balanceOf(bob), 1000e6 + STAKE);
        assertEq(uint8(game.getMatch(id).reason), uint8(Fogline.EndReason.WinnerUnverified));
    }

    function test_MovedMineRevealedIsIllegal() public {
        // bob's piece idx0 at 48 is actually a MINE, but he moves it anyway (hidden)
        uint8[16] memory rb = layoutB();
        rb[0] = MINE;
        rb[8] = SCOUT; // keep 16 pieces (composition is wrong, but the reveal trap fires first)
        uint256 id = startMatch(STAKE, layoutA(), rb);
        step(id, alice, 9, 17);
        step(id, bob, 48, 40); // illegal in truth, undetectable yet
        mv(id, alice, 8, 32, SCOUT, 8);
        step(id, bob, 49, 41);
        mv(id, alice, 32, 40, SCOUT, 8); // attack the moved "mine"
        vm.prank(bob);
        game.revealDefense(id, MINE, salt(bob, 0));
        Fogline.Match memory m = game.getMatch(id);
        assertEq(uint8(m.phase), uint8(Fogline.Phase.Ended));
        assertEq(m.winner, 0);
        assertEq(uint8(m.reason), uint8(Fogline.EndReason.IllegalReveal));
    }

    function test_RevealedMineCannotMove() public {
        uint8[16] memory rb = layoutB();
        rb[0] = MINE; // mine on bob's front row at 48
        rb[8] = SCOUT;
        uint256 id = startMatch(0, layoutA(), rb);
        mv(id, alice, 8, 32, SCOUT, 8);
        step(id, bob, 49, 41);
        mv(id, alice, 32, 48, SCOUT, 8); // scout hits mine: both removed
        vm.prank(bob);
        game.revealDefense(id, MINE, salt(bob, 0));
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertFalse(ps[8].alive);
        assertFalse(ps[16].alive);
        assertEq(game.getBoard(id)[48], 0);
    }

    function test_SapperDefusesMine() public {
        uint8[16] memory rb = layoutB();
        rb[1] = MINE; // mine at 49
        rb[8] = GUARD;
        uint256 id = startMatch(0, layoutA(), rb);
        // alice's Sapper (idx 12, square 12) walks up column 4, then left to column 1
        step(id, alice, 12, 20);
        step(id, bob, 55, 47);
        step(id, alice, 20, 28);
        step(id, bob, 47, 39);
        step(id, alice, 28, 36);
        step(id, bob, 39, 31);
        step(id, alice, 36, 44);
        step(id, bob, 31, 23);
        step(id, alice, 44, 43);
        step(id, bob, 23, 22);
        step(id, alice, 43, 42);
        step(id, bob, 22, 30);
        step(id, alice, 42, 41);
        step(id, bob, 30, 38);
        mv(id, alice, 41, 49, SAPPER, 12); // attack mine at 49
        vm.prank(bob);
        game.revealDefense(id, MINE, salt(bob, 1));
        Fogline.Piece[32] memory ps = game.getPieces(id);
        assertTrue(ps[12].alive);
        assertFalse(ps[17].alive);
        assertEq(game.getBoard(id)[49], 13);
    }

    function test_TimeoutDuringPlay() public {
        uint256 id = startMatch(STAKE, layoutA(), layoutB());
        step(id, alice, 8, 16);
        vm.expectRevert(Fogline.NotExpired.selector);
        game.claimTimeout(id);
        vm.warp(block.timestamp + TO + 1);
        game.claimTimeout(id); // bob stalled
        Fogline.Match memory m = game.getMatch(id);
        assertEq(m.winner, 0);
        assertEq(uint8(m.reason), uint8(Fogline.EndReason.Timeout));
        vm.prank(alice);
        game.verifyLayout(id, layoutA(), salts(alice));
        assertEq(usd.balanceOf(alice), 1000e6 + STAKE);
    }

    function test_TimeoutWithholdingReveal() public {
        uint256 id = startMatch(0, layoutA(), layoutB());
        step(id, alice, 8, 16);
        step(id, bob, 49, 41);
        step(id, alice, 16, 24);
        step(id, bob, 41, 33);
        step(id, alice, 24, 32);
        mv(id, bob, 33, 32, GUARD, 1);
        vm.warp(block.timestamp + TO + 1);
        game.claimTimeout(id); // alice refused to reveal
        assertEq(game.getMatch(id).winner, 1);
    }

    function test_CommitTimeouts() public {
        // only alice commits -> alice wins
        vm.prank(alice);
        uint256 id = game.createMatch(address(usd), STAKE, TO, address(0));
        vm.prank(bob);
        game.joinMatch(id);
        bytes32[16] memory c_alice_4943 = commits(id, alice, layoutA());
        vm.prank(alice);
        game.commitLayout(id, c_alice_4943);
        vm.warp(block.timestamp + TO + 1);
        game.claimTimeout(id);
        assertEq(game.getMatch(id).winner, 0);
        // nobody commits -> refund
        vm.prank(alice);
        uint256 id2 = game.createMatch(address(usd), STAKE, TO, address(0));
        vm.prank(bob);
        game.joinMatch(id2);
        vm.warp(block.timestamp + TO + 1);
        uint256 before = usd.balanceOf(bob);
        game.claimTimeout(id2);
        assertEq(usd.balanceOf(bob), before + STAKE);
        assertEq(uint8(game.getMatch(id2).reason), uint8(Fogline.EndReason.DrawNoCommit));
    }

    function test_Resign() public {
        uint256 id = startMatch(STAKE, layoutA(), layoutB());
        vm.prank(alice);
        game.resign(id);
        assertEq(game.getMatch(id).winner, 1);
        vm.prank(bob);
        game.verifyLayout(id, layoutB(), salts(bob));
        assertEq(usd.balanceOf(bob), 1000e6 + STAKE);
    }

    function test_MaxPlyDrawRefunds() public {
        uint256 id = startMatch(STAKE, layoutA(), layoutB());
        for (uint256 i = 0; i < 100; i++) {
            step(id, alice, 8, 16);
            step(id, bob, 48, 40);
            step(id, alice, 16, 8);
            step(id, bob, 40, 48);
        }
        Fogline.Match memory m = game.getMatch(id);
        assertEq(uint8(m.phase), uint8(Fogline.Phase.Settled));
        assertEq(uint8(m.reason), uint8(Fogline.EndReason.DrawMaxPly));
        assertEq(usd.balanceOf(alice), 1000e6);
        assertEq(usd.balanceOf(bob), 1000e6);
    }
}
