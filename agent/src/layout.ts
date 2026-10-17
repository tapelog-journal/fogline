import { encodePacked, keccak256, toHex, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { COMPOSITION, PIECES, Rank } from "./rules.js";

export interface Layout { ranks: number[]; salts: Hex[] }

export function pieceCommitment(matchId: bigint, player: Address, index: number, rank: number, salt: Hex): Hex {
  return keccak256(encodePacked(["uint256", "address", "uint8", "uint8", "bytes32"], [matchId, player, index, rank, salt]));
}

export function commitments(matchId: bigint, player: Address, l: Layout): Hex[] {
  return l.ranks.map((r, i) => pieceCommitment(matchId, player, i, r, l.salts[i]));
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * A legal random army. Indices: for side 0, 0-7 = back row, 8-15 = front row;
 * for side 1, 0-7 = front row, 8-15 = back row. The Beacon goes on the back row,
 * guarded by the Mines where possible.
 */
export function randomLayout(side: number, rnd: () => number = Math.random): Layout {
  const back = side === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [8, 9, 10, 11, 12, 13, 14, 15];
  const ranks: number[] = new Array(PIECES).fill(-1);
  const b = back[Math.floor(rnd() * back.length)];
  ranks[b] = Rank.BEACON;
  // mines beside the beacon (same row) if possible, else random back-row squares
  const col = b % 8;
  const neighbours = [col - 1, col + 1].filter((c) => c >= 0 && c < 8).map((c) => back[c]);
  const mineSlots = shuffle([...neighbours], rnd).slice(0, 2);
  while (mineSlots.length < 2) {
    const s = back[Math.floor(rnd() * 8)];
    if (ranks[s] === -1 && !mineSlots.includes(s)) mineSlots.push(s);
  }
  for (const s of mineSlots) ranks[s] = Rank.MINE;
  const rest: number[] = [];
  COMPOSITION.forEach((n, r) => { if (r !== Rank.BEACON && r !== Rank.MINE) for (let k = 0; k < n; k++) rest.push(r); });
  shuffle(rest, rnd);
  for (let i = 0; i < PIECES; i++) if (ranks[i] === -1) ranks[i] = rest.pop()!;
  const salts = ranks.map(() => toHex(randomBytes(32)));
  return { ranks, salts };
}

export function isLegalComposition(ranks: number[]): boolean {
  const c = new Array(9).fill(0);
  for (const r of ranks) { if (r < 0 || r > 8) return false; c[r]++; }
  return c.every((n, r) => n === COMPOSITION[r]);
}
