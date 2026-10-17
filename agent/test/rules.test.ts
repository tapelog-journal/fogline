import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, encodePacked } from "viem";
import { combatOutcome, legalMoves, Rank, Phase, type GameState } from "../src/rules.js";
import { isLegalComposition, pieceCommitment, randomLayout } from "../src/layout.js";
import { decide } from "../src/bot.js";

test("random layouts are always legal, beacon on back row", () => {
  for (let i = 0; i < 200; i++) {
    for (const side of [0, 1]) {
      const l = randomLayout(side);
      assert.ok(isLegalComposition(l.ranks));
      const b = l.ranks.indexOf(Rank.BEACON);
      assert.ok(side === 0 ? b < 8 : b >= 8);
      assert.equal(new Set(l.salts).size, 16);
    }
  }
});

test("combat table matches contract", () => {
  assert.equal(combatOutcome(Rank.SCOUT, Rank.BEACON), 0);
  assert.equal(combatOutcome(Rank.WARDEN, Rank.MINE), 2);
  assert.equal(combatOutcome(Rank.SAPPER, Rank.MINE), 0);
  assert.equal(combatOutcome(Rank.GHOST, Rank.WARDEN), 0);
  assert.equal(combatOutcome(Rank.GUARD, Rank.GUARD), 1);
});

test("commitment encoding is abi.encodePacked(uint256,address,uint8,uint8,bytes32)", () => {
  const salt = ("0x" + "11".repeat(32)) as `0x${string}`;
  const who = "0x2052277Caf48a0F1CCc6764790Cf3Ad84639eF30";
  assert.equal(pieceCommitment(5n, who, 3, 7, salt), keccak256(encodePacked(["uint256", "address", "uint8", "uint8", "bytes32"], [5n, who, 3, 7, salt])));
});

function fresh(): { s: GameState; ranks: number[] } {
  const board = new Array(64).fill(0);
  const pieces = [];
  for (let pid = 0; pid < 32; pid++) {
    const pos = pid < 16 ? pid : 48 + (pid - 16);
    board[pos] = pid + 1;
    pieces.push({ commitment: "0x", pos, rank: 0, alive: true, revealed: false, moved: false });
  }
  const s: GameState = { id: 1n, board, pieces, match: { players: ["0xa", "0xb"], token: "0x0", stake: 0n, turnTimeout: 600, phase: Phase.Playing, turn: 0, winner: 2, reason: 0, deadline: 10n ** 12n, ply: 0, pendFrom: 0, pendTo: 0, committed: [true, true], verified: [false, false] } };
  return { s, ranks: randomLayout(0).ranks };
}

test("opening moves only come from the front row and never move immobile pieces", () => {
  const { s, ranks } = fresh();
  const ms = legalMoves(s, 0, ranks);
  assert.ok(ms.length > 0);
  for (const m of ms) {
    assert.ok(m.from >= 8 && m.from < 16);
    assert.notEqual(ranks[m.pieceIndex], Rank.MINE);
    assert.notEqual(ranks[m.pieceIndex], Rank.BEACON);
  }
});

test("bot reveals when defending and claims timeouts", () => {
  const { s } = fresh();
  const l = randomLayout(0);
  s.match.phase = Phase.PendingReveal; s.match.turn = 0; s.match.pendTo = 9;
  assert.deepEqual(decide(s, 0, l, 0n), { kind: "reveal", pieceIndex: 9 });
  s.match.phase = Phase.Playing; s.match.turn = 1; s.match.deadline = 5n;
  assert.equal(decide(s, 0, l, 10n).kind, "claimTimeout");
});
