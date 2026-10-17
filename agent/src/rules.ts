// Fogline rules, mirrored from src/Fogline.sol. Game for entertainment. Not investment advice.
export const SIZE = 8;
export const PIECES = 16;
export const BLOCKED = new Set([26, 37]); // fog banks
export const SCOUT_RANGE = 3;

export const Rank = { BEACON: 0, GHOST: 1, SCOUT: 2, SAPPER: 3, GUARD: 4, KNIGHT: 5, CAPTAIN: 6, WARDEN: 7, MINE: 8 } as const;
export const RANK_NAMES = ["Beacon", "Ghost", "Scout", "Sapper", "Guard", "Knight", "Captain", "Warden", "Mine"];
export const RANK_SHORT = ["B", "G", "S", "P", "U", "K", "C", "W", "M"];
/** required count per rank (index = rank) */
export const COMPOSITION = [1, 1, 3, 2, 3, 2, 1, 1, 2];

export enum Phase { None, Open, Committing, Playing, PendingReveal, Ended, Settled }
export const END_REASONS = ["None", "BeaconCaptured", "Resigned", "Timeout", "DrawMaxPly", "DrawNoCommit", "Cancelled", "IllegalReveal", "WinnerUnverified"];

export const isImmobile = (r: number) => r === Rank.BEACON || r === Rank.MINE;
export const startSquare = (side: number, index: number) => (side === 0 ? index : 48 + index);

/** 0 attacker wins, 1 defender holds, 2 both removed */
export function combatOutcome(att: number, def: number): 0 | 1 | 2 {
  if (def === Rank.BEACON) return 0;
  if (def === Rank.MINE) return att === Rank.SAPPER ? 0 : 2;
  if (att === Rank.GHOST && def === Rank.WARDEN) return 0;
  if (att > def) return 0;
  return 1;
}

export interface PieceView { commitment: string; pos: number; rank: number; alive: boolean; revealed: boolean; moved: boolean }
export interface MatchView {
  players: readonly [string, string]; token: string; stake: bigint; turnTimeout: number; phase: Phase; turn: number;
  winner: number; reason: number; deadline: bigint; ply: number; pendFrom: number; pendTo: number;
  committed: readonly [boolean, boolean]; verified: readonly [boolean, boolean];
}
export interface GameState { id: bigint; match: MatchView; board: number[]; pieces: PieceView[] }

export interface Move { from: number; to: number; pieceIndex: number; attack: boolean; dist: number }

/** All pseudo-legal moves for `side` given our own secret ranks. */
export function legalMoves(state: GameState, side: number, ownRanks: number[]): Move[] {
  const out: Move[] = [];
  const { board } = state;
  for (let i = 0; i < PIECES; i++) {
    const pid = side * PIECES + i;
    const p = state.pieces[pid];
    if (!p.alive) continue;
    const rank = ownRanks[i];
    if (isImmobile(rank)) continue;
    const range = rank === Rank.SCOUT ? SCOUT_RANGE : 1;
    const r0 = Math.floor(p.pos / SIZE), c0 = p.pos % SIZE;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= range; k++) {
        const r = r0 + dr * k, c = c0 + dc * k;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) break;
        const sq = r * SIZE + c;
        if (BLOCKED.has(sq)) break;
        const cell = board[sq];
        if (cell === 0) { out.push({ from: p.pos, to: sq, pieceIndex: i, attack: false, dist: k }); continue; }
        const owner = Math.floor((cell - 1) / PIECES);
        if (owner !== side) out.push({ from: p.pos, to: sq, pieceIndex: i, attack: true, dist: k });
        break;
      }
    }
  }
  return out;
}

/** ASCII board. Own pieces shown when `ownRanks` given, enemy only if revealed. */
export function renderBoard(state: GameState, viewer?: { side: number; ranks: number[] }): string {
  const lines: string[] = [];
  for (let r = SIZE - 1; r >= 0; r--) {
    let line = `${r} `;
    for (let c = 0; c < SIZE; c++) {
      const sq = r * SIZE + c;
      if (BLOCKED.has(sq)) { line += " ~~"; continue; }
      const cell = state.board[sq];
      if (cell === 0) { line += "  ."; continue; }
      const pid = cell - 1, side = Math.floor(pid / PIECES), p = state.pieces[pid];
      let ch = "?";
      if (p.revealed) ch = RANK_SHORT[p.rank];
      else if (viewer && viewer.side === side) ch = RANK_SHORT[viewer.ranks[pid % PIECES]].toLowerCase();
      line += " " + (side === 0 ? "a" : "b") + ch;
    }
    lines.push(line);
  }
  lines.push("   " + Array.from({ length: SIZE }, (_, c) => "  " + c).join(""));
  return lines.join("\n");
}
