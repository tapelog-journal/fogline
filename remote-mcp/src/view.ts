// Player-perspective board rendering for chat assistants.
import { BLOCKED, END_REASONS, legalMoves, Phase, PIECES, RANK_NAMES, SIZE, type GameState } from "../../agent/src/rules";
import type { Layout } from "../../agent/src/layout";

const SHORT = ["B", "G", "S", "P", "U", "K", "C", "W", "M"]; // Beacon Ghost Scout sapPer gUard Knight Captain Warden Mine
export const LEGEND = "Legend: +X = your piece (X = rank letter), ?? = hidden enemy piece, -X = revealed enemy piece, ~~ = fog bank (impassable), .. = empty. Rank letters: B Beacon, G Ghost, S Scout, P Sapper, U Guard, K Knight, C Captain, W Warden, M Mine.";

export function sideOf(s: GameState, addr: string): number {
  const a = addr.toLowerCase();
  return s.match.players[0].toLowerCase() === a ? 0 : s.match.players[1].toLowerCase() === a ? 1 : -1;
}

export function phaseName(p: number) { return Phase[p] ?? String(p); }

export function boardView(s: GameState, side: number, layout?: Layout) {
  const rows: string[] = [];
  for (let r = SIZE - 1; r >= 0; r--) {
    const cells: string[] = [];
    for (let c = 0; c < SIZE; c++) {
      const sq = r * SIZE + c;
      if (BLOCKED.has(sq)) { cells.push("~~"); continue; }
      const cell = s.board[sq];
      if (!cell) { cells.push(".."); continue; }
      const pid = cell - 1, owner = Math.floor(pid / PIECES), p = s.pieces[pid];
      if (owner === side) cells.push("+" + (layout ? SHORT[layout.ranks[pid % PIECES]] : p.revealed ? SHORT[p.rank] : "?"));
      else cells.push(p.revealed ? "-" + SHORT[p.rank] : "??");
    }
    rows.push(`${String(r * 8).padStart(2, "0")}| ${cells.join(" ")}`);
  }
  rows.push("sq| c0 c1 c2 c3 c4 c5 c6 c7  (square = row start at left + column)");
  const mine: { square: number; rank: string; revealed: boolean }[] = [];
  const enemy: { square: number; rank: string; moved: boolean }[] = [];
  for (let pid = 0; pid < 2 * PIECES; pid++) {
    const p = s.pieces[pid];
    if (!p.alive) continue;
    const owner = Math.floor(pid / PIECES);
    if (owner === side) mine.push({ square: p.pos, rank: layout ? RANK_NAMES[layout.ranks[pid % PIECES]] : p.revealed ? RANK_NAMES[p.rank] : "unknown", revealed: p.revealed });
    else enemy.push({ square: p.pos, rank: p.revealed ? RANK_NAMES[p.rank] : "hidden", moved: p.moved });
  }
  const moves = side >= 0 && layout && s.match.phase === Phase.Playing && s.match.turn === side ? legalMoves(s, side, layout.ranks) : [];
  return { ascii: rows.join("\n"), mine: mine.sort((a, b) => a.square - b.square), enemy: enemy.sort((a, b) => a.square - b.square), moves };
}

export function summary(s: GameState, side: number) {
  const m = s.match, now = Math.floor(Date.now() / 1000), left = Number(m.deadline) - now;
  const you = side === 0 ? "side A (start rows 0-1, you advance UP toward row 7)" : side === 1 ? "side B (start rows 6-7, you advance DOWN toward row 0)" : "a spectator";
  let status: string;
  switch (m.phase) {
    case Phase.Open: status = "waiting for an opponent to join"; break;
    case Phase.Committing: status = !m.committed[side] ? "place your army now (auto-army or set-army)" : "waiting for the opponent to place their army"; break;
    case Phase.Playing: status = m.turn === side ? "YOUR TURN: make a move" : "opponent's turn"; break;
    case Phase.PendingReveal: status = m.turn === side ? "your defender must be revealed (handled automatically on your next call)" : "waiting for the opponent to reveal the defending piece"; break;
    case Phase.Ended: status = `game over: ${m.winner === 2 ? "draw" : m.winner === side ? "YOU WON" : "you lost"} (${END_REASONS[m.reason]}); waiting for the winner's army check`; break;
    case Phase.Settled: status = `settled: ${m.winner === 2 ? "draw" : m.winner === side ? "YOU WON" : "you lost"} (${END_REASONS[m.reason]})`; break;
    default: status = phaseName(m.phase);
  }
  const timer = (m.phase === Phase.Playing || m.phase === Phase.PendingReveal || m.phase === Phase.Committing) && left > -86400
    ? ` | turn timer ${m.turnTimeout}s, ${Math.max(0, left)}s left` : "";
  return { you, status, line: `phase ${phaseName(m.phase)} | ply ${m.ply} | you are ${you} | ${status}${timer}` };
}

/** Describe what changed between two snapshots from `side`'s point of view. */
export function diffEvents(a: GameState, b: GameState, side: number): string[] {
  const out: string[] = [];
  for (let pid = 0; pid < 2 * PIECES; pid++) {
    const pa = a.pieces[pid], pb = b.pieces[pid];
    const who = Math.floor(pid / PIECES) === side ? "your" : "enemy";
    const name = (p: typeof pb) => (p.revealed ? RANK_NAMES[p.rank] : who === "your" ? "piece" : "hidden piece");
    if (pa.alive && pb.alive && pa.pos !== pb.pos) out.push(`${who} ${name(pb)} moved ${pa.pos} -> ${pb.pos}`);
    if (!pa.revealed && pb.revealed) out.push(`${who} piece on ${pb.alive ? pb.pos : pa.pos} revealed as ${RANK_NAMES[pb.rank]}`);
    if (pa.alive && !pb.alive) out.push(`${who} ${name(pb)} on ${pa.pos} was removed`);
  }
  return out;
}
