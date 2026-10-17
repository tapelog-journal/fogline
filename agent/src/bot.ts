// Baseline Fogline bot: legal, cautious, slightly aggressive. Not strong; a starting point for agents.
import { parseEventLogs } from "viem";
import { foglineAbi } from "./abi.js";
import type { FoglineClient } from "./client.js";
import { combatOutcome, legalMoves, Phase, PIECES, Rank, RANK_NAMES, SIZE, type GameState, type Move } from "./rules.js";
import type { Layout } from "./layout.js";

export type Action =
  | { kind: "commit" } | { kind: "move"; move: Move } | { kind: "reveal"; pieceIndex: number }
  | { kind: "verify" } | { kind: "claimTimeout" } | { kind: "claimUnverified" } | { kind: "wait"; why: string } | { kind: "done" };

export interface BotOpts { rnd?: () => number }

export function scoreMove(state: GameState, side: number, ranks: number[], m: Move, rnd: () => number): number {
  const myRank = ranks[m.pieceIndex];
  const forward = side === 0 ? 1 : -1;
  const dRow = Math.floor(m.to / SIZE) - Math.floor(m.from / SIZE);
  let s = rnd() * 4; // noise
  s += dRow * forward * 3; // advance
  if (myRank === Rank.SCOUT && m.dist > 1) s -= 1; // long scout moves reveal it
  if (m.attack) {
    const target = state.pieces[state.board[m.to] - 1];
    if (target.revealed) {
      const o = combatOutcome(myRank, target.rank);
      s += o === 0 ? (target.rank === Rank.BEACON ? 10_000 : 60 + target.rank * 5) : o === 2 ? 5 : -80;
    } else {
      // probing unknown pieces: cheap pieces probe, strong pieces hesitate (could be a Mine)
      s += 18 - myRank * 2.5;
      if (myRank === Rank.SAPPER && !target.moved) s += 10; // unmoved could be a Mine
      if (myRank === Rank.WARDEN && !target.moved) s -= 15;
    }
  } else {
    // close in on enemy pieces that are not known to be Mines (the Beacon hides among them)
    const near = (sq: number) => {
      let best = 99;
      for (let pid = (1 - side) * PIECES; pid < (2 - side) * PIECES; pid++) {
        const e = state.pieces[pid];
        if (!e.alive || (e.revealed && e.rank === Rank.MINE)) continue;
        const d = Math.abs(Math.floor(e.pos / SIZE) - Math.floor(sq / SIZE)) + Math.abs((e.pos % SIZE) - (sq % SIZE));
        if (d < best) best = d;
      }
      return best;
    };
    s += (near(m.from) - near(m.to)) * 4;
    // avoid stepping next to revealed enemies that beat us
    for (const d of [1, -1, SIZE, -SIZE]) {
      const n = m.to + d;
      if (n < 0 || n >= 64 || (Math.abs(d) === 1 && Math.floor(n / SIZE) !== Math.floor(m.to / SIZE))) continue;
      const cell = state.board[n];
      if (!cell) continue;
      const pid = cell - 1;
      if (Math.floor(pid / PIECES) === side) continue;
      const e = state.pieces[pid];
      if (e.revealed && combatOutcome(e.rank, myRank) === 0 && e.rank !== Rank.MINE && e.rank !== Rank.BEACON) s -= 30;
    }
  }
  return s;
}

export function decide(state: GameState, side: number, layout: Layout | undefined, now: bigint, rnd: () => number = Math.random): Action {
  const m = state.match;
  if (side < 0) return { kind: "wait", why: "not a player in this match" };
  const expired = now > m.deadline;
  switch (m.phase) {
    case Phase.Open: return { kind: "wait", why: "waiting for an opponent to join" };
    case Phase.Committing:
      if (!m.committed[side]) return { kind: "commit" };
      return expired ? { kind: "claimTimeout" } : { kind: "wait", why: "waiting for opponent's layout" };
    case Phase.Playing:
    case Phase.PendingReveal: {
      if (m.turn !== side) return expired ? { kind: "claimTimeout" } : { kind: "wait", why: "opponent to act" };
      if (!layout) return { kind: "wait", why: "missing local layout secrets" };
      if (m.phase === Phase.PendingReveal) return { kind: "reveal", pieceIndex: (state.board[m.pendTo] - 1) % PIECES };
      const moves = legalMoves(state, side, layout.ranks);
      if (moves.length === 0) return { kind: "wait", why: "no legal moves (will time out)" };
      let best = moves[0], bs = -Infinity;
      for (const mv of moves) { const sc = scoreMove(state, side, layout.ranks, mv, rnd); if (sc > bs) { bs = sc; best = mv; } }
      return { kind: "move", move: best };
    }
    case Phase.Ended:
      if (m.winner === side) return layout ? { kind: "verify" } : { kind: "wait", why: "missing layout to verify" };
      return expired ? { kind: "claimUnverified" } : { kind: "wait", why: "waiting for winner to verify" };
    default: return { kind: "done" };
  }
}

/** Run one decision for `client` in match `id`. Returns a human-readable log line. */
export async function botStep(client: FoglineClient, id: bigint, opts: BotOpts = {}): Promise<{ action: Action; log: string }> {
  const state = await client.state(id);
  const side = client.sideOf(state);
  const layout = client.layout(id);
  const action = decide(state, side, layout, await client.now(), opts.rnd);
  let log = "";
  switch (action.kind) {
    case "commit": await client.commitLayout(id, side); log = `side ${side} committed a hidden army`; break;
    case "move": {
      const mv = action.move, r = layout!.ranks[mv.pieceIndex], s = layout!.salts[mv.pieceIndex];
      const rc = await client.move(id, mv.from, mv.to, r, s);
      log = `side ${side} ${mv.attack ? "ATTACKS" : "moves"} ${mv.from}->${mv.to}${mv.attack || mv.dist > 1 ? ` (reveals ${RANK_NAMES[r]})` : ""}` + combatNote(rc.logs);
      break;
    }
    case "reveal": {
      const i = action.pieceIndex;
      const rc = await client.revealDefense(id, layout!.ranks[i], layout!.salts[i]);
      log = `side ${side} reveals defender ${RANK_NAMES[layout!.ranks[i]]}` + combatNote(rc.logs);
      break;
    }
    case "verify": await client.verifyLayout(id, layout!); log = `side ${side} proves a legal army and collects`; break;
    case "claimTimeout": await client.claimTimeout(id); log = `side ${side} claims timeout`; break;
    case "claimUnverified": await client.claimUnverified(id); log = `side ${side} claims: winner never verified`; break;
    case "wait": log = `side ${side} waits: ${action.why}`; break;
    case "done": log = "match settled"; break;
  }
  return { action, log };
}

const OUTCOME = ["attacker wins", "defender holds", "both removed"];
function combatNote(logs: any[]): string {
  const ev = parseEventLogs({ abi: foglineAbi, logs, eventName: "Combat" })[0] as any;
  if (!ev) return "";
  const a = ev.args;
  return ` -> ${RANK_NAMES[a.attackerRank]} vs ${RANK_NAMES[a.defenderRank]}: ${OUTCOME[a.outcome]}`;
}
