// House bot difficulty levels for Fogline. Game for entertainment. Testnet only.
//   easy   - mostly random legal moves, random army
//   normal - the baseline bot (bot.ts scoreMove)
//   hard   - probabilistic inference over the opponent's hidden ranks: each hidden enemy piece gets a
//            probability distribution over ranks, consistent with the remaining army composition and with
//            what the chain shows (a piece that has moved can't be a Beacon or Mine). Moves are scored by
//            expected material gain of attacks, the risk of being attacked next turn, and pressure on the
//            squares most likely to hide the enemy Beacon. Uses only public onchain information.
import { decide, scoreMove, type Action } from "./bot.js";
import { randomLayout, type Layout } from "./layout.js";
import { combatOutcome, COMPOSITION, legalMoves, PIECES, Rank, SIZE, type GameState, type Move } from "./rules.js";
import { randomBytes } from "node:crypto";
import { toHex } from "viem";

export const LEVELS = ["easy", "normal", "hard"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
export function parseLevel(v: unknown): Level {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "" || s === "undefined") return "normal";
  if ((LEVELS as readonly string[]).includes(s)) return s as Level;
  if (s === "medium") return "normal";
  throw new Error("level must be easy, normal or hard");
}

/** Material value of each rank (index = rank). The Beacon is the game. */
export const VALUE = [1000, 30, 12, 26, 18, 34, 50, 80, 14];

/**
 * Hidden-rank inference: P[pid][rank] for every live, unrevealed enemy piece.
 * Row constraint: each piece is exactly one rank. Column constraint: the number of pieces of each rank still
 * unaccounted for (composition minus enemy pieces whose rank the chain revealed, alive or dead).
 * Solved with iterative proportional fitting (Sinkhorn) from a structured prior.
 */
export function inferRanks(state: GameState, side: number): Map<number, number[]> {
  const enemy = 1 - side, left = [...COMPOSITION];
  const hidden: number[] = [];
  for (let i = 0; i < PIECES; i++) {
    const pid = enemy * PIECES + i, p = state.pieces[pid];
    if (p.revealed) left[p.rank] = Math.max(0, left[p.rank] - 1);
    else if (p.alive) hidden.push(pid);
  }
  const out = new Map<number, number[]>();
  if (!hidden.length) return out;
  const backRow = enemy === 0 ? 0 : SIZE - 1;
  const M = hidden.map((pid) => {
    const p = state.pieces[pid], row = Math.floor(p.pos / SIZE);
    return left.map((n, r) => {
      if (n <= 0) return 0;
      if (p.moved && (r === Rank.BEACON || r === Rank.MINE)) return 0;
      let w = 1;
      if (!p.moved && row === backRow && (r === Rank.BEACON || r === Rank.MINE)) w = 2.2; // armies usually hide them at the back
      if (!p.moved && row !== backRow && r === Rank.BEACON) w = 0.35;
      return w;
    });
  });
  const colTarget = left.map((n) => n);
  const totalLeft = colTarget.reduce((a, b) => a + b, 0) || 1;
  for (let k = 0; k < colTarget.length; k++) colTarget[k] *= hidden.length / totalLeft; // tolerate inconsistent counts
  for (let it = 0; it < 60; it++) {
    for (const row of M) { const s = row.reduce((a, b) => a + b, 0); if (s > 0) for (let r = 0; r < row.length; r++) row[r] /= s; }
    for (let r = 0; r < colTarget.length; r++) {
      const s = M.reduce((a, row) => a + row[r], 0);
      if (s > 0) for (const row of M) row[r] *= colTarget[r] / s;
    }
  }
  hidden.forEach((pid, k) => { const row = M[k], s = row.reduce((a, b) => a + b, 0) || 1; out.set(pid, row.map((x) => x / s)); });
  return out;
}

/** Rank distribution of any enemy piece (point mass when revealed). */
function dist(state: GameState, pid: number, inf: Map<number, number[]>): number[] {
  const p = state.pieces[pid];
  if (p.revealed) { const d = new Array(9).fill(0); d[p.rank] = 1; return d; }
  return inf.get(pid) ?? new Array(9).fill(1 / 9);
}

/** Expected material swing (for us) of our piece of rank `a` attacking an enemy with rank distribution `d`. */
export function attackEV(a: number, d: number[]): number {
  let ev = 0;
  for (let r = 0; r < 9; r++) {
    if (!d[r]) continue;
    const o = combatOutcome(a, r);
    ev += d[r] * (o === 0 ? VALUE[r] : o === 1 ? -VALUE[a] : VALUE[r] - VALUE[a]);
  }
  return ev;
}

const NEIGH = [1, -1, SIZE, -SIZE];
function neighbours(sq: number) {
  return NEIGH.map((d) => sq + d).filter((n, k) => n >= 0 && n < 64 && (Math.abs(NEIGH[k]) !== 1 || Math.floor(n / SIZE) === Math.floor(sq / SIZE)));
}
const manhattan = (a: number, b: number) => Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs((a % SIZE) - (b % SIZE));

/** How dangerous square `sq` is for our piece of rank `a` (expected loss if an adjacent enemy attacks it next). */
function danger(state: GameState, side: number, sq: number, a: number, mineRevealed: boolean, inf: Map<number, number[]>, ignore = -1): number {
  let worst = 0;
  for (const n of neighbours(sq)) {
    const cell = state.board[n];
    if (!cell || n === ignore) continue;
    const pid = cell - 1;
    if (Math.floor(pid / PIECES) === side) continue;
    const d = dist(state, pid, inf);
    let pWin = 0, pTrade = 0;
    for (let r = 0; r < 9; r++) {
      if (!d[r] || r === Rank.BEACON || r === Rank.MINE) continue; // immobile pieces can't attack
      const o = combatOutcome(r, a);
      if (o === 0) pWin += d[r]; else if (o === 2) pTrade += d[r];
    }
    // the enemy only attacks for sure when it knows what we are
    const knows = mineRevealed ? 1 : 0.55;
    worst = Math.max(worst, knows * (pWin * VALUE[a] + pTrade * VALUE[a] * 0.5));
  }
  return worst;
}

export function scoreHard(state: GameState, side: number, ranks: number[], m: Move, inf: Map<number, number[]>, rnd: () => number): number {
  const a = ranks[m.pieceIndex], me = state.pieces[side * PIECES + m.pieceIndex], forward = side === 0 ? 1 : -1;
  const willReveal = me.revealed || m.attack || m.dist > 1;
  let s = rnd() * 1.5;
  // likely Beacon squares: hidden, unmoved enemy pieces weighted by P(Beacon)
  const targets: { sq: number; w: number }[] = [];
  for (const [pid, d] of inf) if (d[Rank.BEACON] > 0.02) targets.push({ sq: state.pieces[pid].pos, w: d[Rank.BEACON] });
  for (let i = 0; i < PIECES; i++) { const e = state.pieces[(1 - side) * PIECES + i]; if (e.alive && e.revealed && e.rank === Rank.BEACON) targets.push({ sq: e.pos, w: 5 }); }
  const pull = (sq: number) => targets.reduce((acc, t) => acc + t.w / (1 + manhattan(sq, t.sq)), 0);

  if (m.attack) {
    const tpid = state.board[m.to] - 1, d = dist(state, tpid, inf);
    if (d[Rank.BEACON] > 0.999) return 1e6; // known Beacon: take it
    s += attackEV(a, d);
    s += d[Rank.BEACON] * 400; // a real chance to win outright
    if (!me.revealed) s -= VALUE[a] * 0.08; // attacking reveals our rank
    if (!state.pieces[tpid].revealed) s += 4; // information gain
    // after winning we stand on m.to: account for the counter-attack (approximate with the win probability)
    let pWin = 0; for (let r = 0; r < 9; r++) if (d[r] && combatOutcome(a, r) === 0) pWin += d[r];
    s -= pWin * danger(state, side, m.to, a, true, inf, m.to) * 0.6;
  } else {
    const before = danger(state, side, m.from, a, me.revealed, inf), after = danger(state, side, m.to, a, willReveal, inf);
    s += (before - after) * 0.9;
    if (m.dist > 1 && !me.revealed) s -= 3; // long Scout moves give the Scout away
    // pressure: strong-but-not-precious pieces and Sappers (mine clearing) push toward likely Beacon squares
    const pushW = a === Rank.WARDEN ? 3 : a === Rank.SAPPER ? 9 : a === Rank.SCOUT ? 7 : a === Rank.GHOST ? 2 : 6;
    s += (pull(m.to) - pull(m.from)) * pushW * 10;
    s += (Math.floor(m.to / SIZE) - Math.floor(m.from / SIZE)) * forward * 0.8; // gentle advance
    // stepping next to hidden enemies with our weakest pieces is how you scout
    if (a === Rank.SCOUT || a === Rank.GUARD) for (const n of neighbours(m.to)) { const c = state.board[n]; if (c && Math.floor((c - 1) / PIECES) !== side && !state.pieces[c - 1].revealed) s += 1.5; }
  }
  // defend our own Beacon: reward moves that end next to enemies threatening it
  for (let i = 0; i < PIECES; i++) {
    if (ranks[i] !== Rank.BEACON) continue;
    const b = state.pieces[side * PIECES + i];
    if (!b.alive) continue;
    const dTo = manhattan(m.to, b.pos), dFrom = manhattan(m.from, b.pos);
    let threat = 0;
    for (const n of neighbours(b.pos)) { const c = state.board[n]; if (c && Math.floor((c - 1) / PIECES) !== side) threat++; }
    if (threat && m.attack && dTo === 1) s += 300;
    if (threat && dTo < dFrom && a !== Rank.WARDEN) s += 8;
    if (a !== Rank.BEACON && dFrom === 1 && dTo > 1 && !threat) s -= 1; // keep a guard near home
  }
  return s;
}

function pickHard(state: GameState, side: number, ranks: number[], moves: Move[], rnd: () => number): Move {
  const inf = inferRanks(state, side);
  let best = moves[0], bs = -Infinity;
  for (const mv of moves) { const sc = scoreHard(state, side, ranks, mv, inf, rnd); if (sc > bs) { bs = sc; best = mv; } }
  return best;
}

function pickEasy(state: GameState, side: number, ranks: number[], moves: Move[], rnd: () => number): Move {
  // take an exposed Beacon if one is right there (even beginners see that); otherwise mostly random
  for (const mv of moves) if (mv.attack) { const t = state.pieces[state.board[mv.to] - 1]; if (t.revealed && t.rank === Rank.BEACON) return mv; }
  if (rnd() < 0.6) return moves[Math.floor(rnd() * moves.length)];
  let best = moves[0], bs = -Infinity;
  for (const mv of moves) { const sc = scoreMove(state, side, ranks, mv, rnd) + rnd() * 60; if (sc > bs) { bs = sc; best = mv; } }
  return best;
}

/** decide() with the move choice made by the given level. Non-move actions are identical for every level. */
export function decideLevel(state: GameState, side: number, layout: Layout | undefined, now: bigint, level: Level, rnd: () => number = Math.random): Action {
  const a = decide(state, side, layout, now, rnd);
  if (a.kind !== "move" || level === "normal" || !layout) return a;
  const moves = legalMoves(state, side, layout.ranks);
  if (!moves.length) return a;
  return { kind: "move", move: level === "hard" ? pickHard(state, side, layout.ranks, moves, rnd) : pickEasy(state, side, layout.ranks, moves, rnd) };
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Starting army for a level. Hard: Beacon off the edges of the back row, a Mine in front and one beside it, Sappers and Scouts up front. */
export function layoutFor(level: Level, side: number, rnd: () => number = Math.random): Layout {
  if (level === "normal") return randomLayout(side, rnd);
  const salts = Array.from({ length: PIECES }, () => toHex(randomBytes(32)));
  const pool: number[] = [];
  COMPOSITION.forEach((n, r) => { for (let k = 0; k < n; k++) pool.push(r); });
  if (level === "easy") return { ranks: shuffle(pool, rnd), salts };
  const back = side === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [8, 9, 10, 11, 12, 13, 14, 15];
  const front = side === 0 ? [8, 9, 10, 11, 12, 13, 14, 15] : [0, 1, 2, 3, 4, 5, 6, 7];
  const ranks = new Array(PIECES).fill(-1);
  const col = 1 + Math.floor(rnd() * 6);
  ranks[back[col]] = Rank.BEACON;
  ranks[front[col]] = Rank.MINE;
  ranks[back[col + (rnd() < 0.5 ? -1 : 1)]] = Rank.MINE;
  const rest = shuffle(pool.filter((r) => r !== Rank.BEACON && r !== Rank.MINE), rnd);
  // prefer Scouts, Sappers and a Guard on the front row, the Captain/Warden one step back for counter-attacks
  const frontPref = (r: number) => (r === Rank.SCOUT ? 3 : r === Rank.SAPPER ? 2 : r === Rank.GUARD ? 1 : r === Rank.KNIGHT ? 1 : 0) + rnd() * 1.5;
  rest.sort((x, y) => frontPref(y) - frontPref(x));
  for (const sq of shuffle(front.filter((s) => ranks[s] === -1), rnd)) ranks[sq] = rest.shift()!;
  for (const sq of back) if (ranks[sq] === -1) ranks[sq] = rest.shift()!;
  return { ranks, salts };
}
