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
  const you = side === 0 ? "side A (ranks 1-2, moving up toward rank 8)" : side === 1 ? "side B (ranks 7-8, moving toward rank 1)" : "a spectator";
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

// ---------------------------------------------------------------- human coordinates + markdown board
const FILES = "abcdefgh";
/** square 0..63 -> "a1".."h8" (file = column a-h, rank = row 1-8; a1 = square 0) */
export const coord = (sq: number) => `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`;
/** accepts "c2", "C2" or a numeric square ("10"); returns 0..63 or NaN */
export function parseSquare(v: unknown): number {
  const s = String(v ?? "").trim().toLowerCase();
  const m = s.match(/^([a-h])([1-8])$/);
  if (m) return (Number(m[2]) - 1) * 8 + FILES.indexOf(m[1]);
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 0 && n <= 63 ? n : NaN; }
  return NaN;
}
export const ABBR = ["Bc", "Gh", "Sc", "Sa", "Gu", "Kn", "Ca", "Wa", "Mi"];
export const MD_LEGEND = "🔵 = yours · 🔴 = enemy (revealed) · ❓ = hidden enemy · 🌫️ = fog (impassable) · 📍 = last move landed here, · = it came from here. Bc Beacon · Gh Ghost · Sc Scout · Sa Sapper · Gu Guard · Kn Knight · Ca Captain · Wa Warden · Mi Mine";

export interface LastMove { from: number; to: number }

/** GitHub-flavored markdown table. Own side at the bottom (side B sees the board rotated). */
export function boardMd(s: GameState, side: number, layout?: Layout, last?: LastMove): string {
  const flip = side === 1;
  const rows = flip ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const out = ["|   | " + cols.map((c) => FILES[c]).join(" | ") + " |", "|:-:|" + cols.map(() => ":-:").join("|") + "|"];
  for (const r of rows) {
    const cells = cols.map((c) => {
      const sq = r * 8 + c;
      let t: string;
      if (BLOCKED.has(sq)) t = "🌫️";
      else {
        const cell = s.board[sq];
        if (!cell) t = last && last.from === sq ? "·" : " ";
        else {
          const pid = cell - 1, owner = Math.floor(pid / PIECES), p = s.pieces[pid];
          if (owner === side) t = "🔵" + (layout ? ABBR[layout.ranks[pid % PIECES]] : p.revealed ? ABBR[p.rank] : "?");
          else t = p.revealed ? "🔴" + ABBR[p.rank] : "❓";
        }
      }
      return last && last.to === sq && t.trim() ? `📍${t}` : t;
    });
    out.push(`| **${r + 1}** | ` + cells.join(" | ") + " |");
  }
  return out.join("\n");
}

/** Legal moves grouped per piece, e.g. "Scout b2 → b3, b4, b5, b6⚔️" */
export function groupMoves(moves: { from: number; to: number; piece?: string; attack: boolean }[]) {
  const g = new Map<number, { piece?: string; from: number; tos: { to: number; attack: boolean }[] }>();
  for (const m of moves) { if (!g.has(m.from)) g.set(m.from, { piece: m.piece, from: m.from, tos: [] }); g.get(m.from)!.tos.push({ to: m.to, attack: m.attack }); }
  return [...g.values()];
}
