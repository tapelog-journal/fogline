// Server-side board picture for chat assistants: one SVG per (match, ply, viewer), rasterized to PNG.
// Uses the same original art system as the web viewer (docs/art/art.js): tabletops, piece skins,
// fog styles, trails, effects and banners. Fog of war is applied BEFORE drawing: a hidden piece is
// passed in as rank null, so its rank never reaches the SVG. Game for entertainment. Not investment advice.
// @ts-ignore plain JS module shared with the GitHub Pages viewer
import * as A from "../../docs/art/art.js";
import { BLOCKED, END_REASONS, Phase, PIECES, RANK_NAMES, type GameState } from "../../agent/src/rules";
import type { Layout } from "../../agent/src/layout";

export interface Look { skin: number; table: number; fog: number; trail: number; banner: number; fx: number[] }
export const DEFAULT_LOOK: Look = { skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] };

/** One drawable token. rank === null means hidden (fog of war). */
export interface Cell { sq: number; side: 0 | 1; rank: number | null }
export interface LastAction { from: number; to: number; side: number; attack: boolean; outcome?: number; attackerRank?: number; defenderRank?: number }

export interface BoardScene {
  matchId: string; ply: number; phase: number; turn: number; winner: number; reason: number;
  viewSide: number; // 0 / 1 = that player's view, -1 = spectator
  cells: Cell[];
  captured: [Cell[], Cell[]]; // dead pieces per side (rank only if revealed)
  last?: LastAction;
  prev?: LastAction; // the move before (usually the viewer's own), drawn fainter
  looks: [Look, Look];
  names?: [string, string]; // public labels, e.g. short wallet address or "TapeLog bot"
}

const FILES = "abcdefgh";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Fog-of-war filter. Own ranks come from the secret layout; everything else only if revealed onchain. */
export function sceneFrom(s: GameState, viewSide: number, layout: Layout | undefined, looks: [Look, Look], last?: LastAction): BoardScene {
  const cells: Cell[] = [], captured: [Cell[], Cell[]] = [[], []];
  const rankOf = (pid: number): number | null => {
    const owner = Math.floor(pid / PIECES), p = s.pieces[pid];
    if (p.revealed) return Number(p.rank);
    if (owner === viewSide && layout) return layout.ranks[pid % PIECES];
    return null;
  };
  for (let sq = 0; sq < 64; sq++) {
    const v = Number(s.board[sq]);
    if (!v) continue;
    const pid = v - 1;
    cells.push({ sq, side: (Math.floor(pid / PIECES) as 0 | 1), rank: rankOf(pid) });
  }
  for (let pid = 0; pid < 2 * PIECES; pid++) {
    const p = s.pieces[pid];
    if (p.alive || s.match.phase < Phase.Playing) continue;
    const side = Math.floor(pid / PIECES) as 0 | 1;
    captured[side].push({ sq: -1, side, rank: rankOf(pid) });
  }
  const m = s.match;
  return { matchId: s.id.toString(), ply: Number(m.ply), phase: Number(m.phase), turn: Number(m.turn), winner: Number(m.winner), reason: Number(m.reason), viewSide, cells, captured, last, looks };
}

// ---------------------------------------------------------------- geometry (whole pixels, uniform cells)
export const W = 800, H = 950;
export const CELL = 80;
const BX = 80, BY = 160; // top-left of square grid (8 * 80 = 640)
const BAND = 28; // coordinate band around the grid

function cellXY(sq: number, flip: boolean) {
  const r = Math.floor(sq / 8), c = sq % 8;
  const col = flip ? 7 - c : c, row = flip ? r : 7 - r;
  return { x: BX + col * CELL, y: BY + row * CELL };
}
const center = (sq: number, flip: boolean) => { const p = cellXY(sq, flip); return { x: p.x + CELL / 2, y: p.y + CELL / 2 }; };

function hexToRgb(c: string): [number, number, number] | null {
  const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const lum = (c: string) => { const v = hexToRgb(c); return v ? (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 : 0.2; };

function piece(c: Cell, look: Look, x: number, y: number, size: number, pip = true) {
  const svg = A.pieceSVG({ skin: look.skin, side: c.side, rank: c.rank, fog: look.fog, size: String(size), pip }) as string;
  return `<g transform="translate(${x} ${y})">${svg.replace('class="piece-svg" ', "")}</g>`;
}

function fogbank(x: number, y: number, color: string) {
  return `<g transform="translate(${x} ${y}) scale(${CELL / 100})"><rect x="6" y="6" width="88" height="88" rx="10" fill="${color}" opacity=".10"/><g fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".85"><path d="M14 36q12-10 24 0t24 0 24 0"/><path d="M14 52q12-10 24 0t24 0 24 0"/><path d="M14 68q12-10 24 0t24 0 24 0"/></g></g>`;
}

function arrow(a: { x: number; y: number }, b: { x: number; y: number }, color: string) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y) - 26;
  const deg = (ang * 180) / Math.PI;
  return `<g transform="translate(${a.x} ${a.y}) rotate(${deg.toFixed(2)})" opacity=".9"><path d="M0 0H${(len - 14).toFixed(1)}" stroke="#000" stroke-opacity=".45" stroke-width="12" stroke-linecap="round"/><path d="M0 0H${(len - 14).toFixed(1)}" stroke="${color}" stroke-width="7" stroke-linecap="round"/><path d="M${len.toFixed(1)} 0l-20 -13v26z" fill="${color}" stroke="#000" stroke-opacity=".45" stroke-width="2" stroke-linejoin="round"/></g>`;
}

function trailFx(id: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  if (id === 17) { // Ember Trail: drifting embers along the path
    let s = "";
    for (let i = 0; i < 16; i++) {
      const t = i / 15, x = a.x + (b.x - a.x) * t + ((i * 7) % 11) - 5, y = a.y + (b.y - a.y) * t - ((i * 5) % 13) + 2;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.5 + (i % 3) * 1.4).toFixed(1)}" fill="${i % 2 ? "#ff8a1f" : "#ffd36b"}" opacity="${(0.35 + 0.6 * t).toFixed(2)}"/>`;
    }
    return `<g filter="url(#fxglow)">${s}</g>`;
  }
  if (id === 18) { // Comet Trail: cyan streak into a bright head
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, len = Math.hypot(b.x - a.x, b.y - a.y);
    return `<g transform="translate(${a.x} ${a.y}) rotate(${ang.toFixed(2)})" filter="url(#fxglow)"><rect x="0" y="-5" width="${len.toFixed(1)}" height="10" rx="5" fill="url(#cometg)"/><circle cx="${len.toFixed(1)}" cy="0" r="9" fill="#e6fdff" opacity=".85"/></g>`;
  }
  return "";
}

function captureFx(fx: number[], p: { x: number; y: number }, color: string, kind: "capture" | "mine" | "beacon" | "reveal") {
  if (kind === "beacon" && fx.includes(16)) { // Beacon Victory: rays + confetti
    let rays = "", conf = "";
    for (let i = 0; i < 24; i++) rays += `<path d="M0 0L${(Math.cos((i / 24) * Math.PI * 2 - 0.06) * 170).toFixed(1)} ${(Math.sin((i / 24) * Math.PI * 2 - 0.06) * 170).toFixed(1)}L${(Math.cos((i / 24) * Math.PI * 2 + 0.06) * 170).toFixed(1)} ${(Math.sin((i / 24) * Math.PI * 2 + 0.06) * 170).toFixed(1)}z"/>`;
    const cols = [color, "#fff", "#ff3df2", "#18f0ff", "#7dff8a"];
    for (let i = 0; i < 40; i++) { const a = (i * 2.399) % (Math.PI * 2), d = 30 + ((i * 37) % 120); conf += `<rect x="${(Math.cos(a) * d).toFixed(1)}" y="${(Math.sin(a) * d).toFixed(1)}" width="7" height="11" rx="1.5" fill="${cols[i % 5]}" transform="rotate(${(i * 47) % 360} ${(Math.cos(a) * d).toFixed(1)} ${(Math.sin(a) * d).toFixed(1)})"/>`; }
    return `<g transform="translate(${p.x} ${p.y})"><g fill="${color}" opacity=".28">${rays}</g><circle r="46" fill="url(#burstg)"/>${conf}</g>`;
  }
  if (kind === "mine" && fx.includes(15)) { // Mine Blast: shockwave rings + debris
    let deb = "";
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, d = 44 + (i % 4) * 9; deb += `<rect x="${(Math.cos(a) * d - 3).toFixed(1)}" y="${(Math.sin(a) * d - 3).toFixed(1)}" width="${4 + (i % 3) * 2}" height="${4 + (i % 2) * 3}" rx="1" fill="${i % 2 ? "#ff8a1f" : "#3a3a3a"}"/>`; }
    return `<g transform="translate(${p.x} ${p.y})" filter="url(#fxglow)"><circle r="30" fill="url(#blastg)"/><circle r="36" fill="none" stroke="#fff2a8" stroke-width="4"/><circle r="48" fill="none" stroke="#ff8a1f" stroke-width="3" opacity=".8"/><circle r="58" fill="none" stroke="#ff2d2d" stroke-width="2" opacity=".6"/>${deb}</g>`;
  }
  if ((kind === "capture" || kind === "mine" || kind === "beacon") && fx.includes(13)) { // Capture Burst
    let sp = "";
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2 + (i % 2) * 0.15, d = 40 + (i % 4) * 7; sp += `<circle cx="${(Math.cos(a) * d).toFixed(1)}" cy="${(Math.sin(a) * d).toFixed(1)}" r="${2 + (i % 3)}" fill="${i % 3 ? color : "#fff"}"/>`; }
    return `<g transform="translate(${p.x} ${p.y})" filter="url(#fxglow)"><circle r="38" fill="none" stroke="${color}" stroke-width="3.5"/>${sp}</g>`;
  }
  if (kind === "reveal" && fx.includes(14)) return `<circle cx="${p.x}" cy="${p.y}" r="44" fill="url(#halog)"/>`;
  if (kind === "reveal") return "";
  return `<circle cx="${p.x}" cy="${p.y}" r="37" fill="none" stroke="#fff" stroke-width="2.5" opacity=".75" stroke-dasharray="6 5"/>`; // free basic capture mark
}

const SKIN_NAMES: Record<number, string> = { 0: "Standard pieces", 1: "Tape Neon pieces", 2: "Candle Glow pieces", 5: "Neon Circuit pieces", 6: "Obsidian & Gold pieces", 7: "Paper Origami pieces", 8: "Frost Glass pieces" };

function banner(id: number, title: string, sub: string, cx: number, cy: number) {
  const B = (A.BANNERS as any)[id];
  if (id === 21 || id === 22) {
    const svg = (B.html(esc(title), esc(sub)) as string).replace(/ width="\d+"/, ' width="560" height="150"').replace("<svg ", `<svg x="${cx - 280}" y="${cy - 75}" `);
    return `<g filter="url(#dropsh)">${svg}</g>`;
  }
  return `<g filter="url(#dropsh)"><rect x="${cx - 220}" y="${cy - 52}" width="440" height="104" rx="14" fill="#0b0b0d" fill-opacity=".8" stroke="#ffd400" stroke-width="3"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="40" font-weight="800" fill="#fff">${esc(title)}</text><text x="${cx}" y="${cy + 32}" text-anchor="middle" font-size="17" font-weight="500" fill="#d9d9d9">${esc(sub)}</text></g>`;
}

/** Build the full board picture as an SVG string. */
/** Tabletop id the picture uses: the viewer's own tabletop, side A's for spectators. */
export const tableOf = (sc: BoardScene) => (sc.viewSide >= 0 ? sc.looks[sc.viewSide] : sc.looks[0]).table;
/** Standalone tabletop backdrop (expensive procedural filters), so a renderer can rasterize it once and reuse it. */
export function envSvg(table: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` + (A.envMarkup(table) as string).replace("<svg ", `<svg x="0" y="0" width="${W}" height="${H}" `) + `</svg>`;
}

/** Build the full board picture as an SVG string. `envImage` = pre-rendered backdrop (data URL) to skip the filters. */
export function boardSvg(sc: BoardScene, opts: { envImage?: string } = {}): string {
  const flip = sc.viewSide === 1;
  const bottom = sc.viewSide === 1 ? 1 : 0, top = 1 - bottom;
  const tableLook = sc.viewSide >= 0 ? sc.looks[sc.viewSide] : sc.looks[0];
  const T = A.tableStyle(tableLook.table);
  const env = opts.envImage
    ? `<image x="0" y="0" width="${W}" height="${H}" href="${opts.envImage}"/>`
    : (A.envMarkup(tableLook.table) as string).replace("<svg ", `<svg x="0" y="0" width="${W}" height="${H}" `);
  const darkTable = lum(T.frame) < 0.55;
  const labelCol = "#f4f1e8";
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">`);
  out.push(`<defs>
<filter id="fxglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="ringglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="dropsh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".6"/></filter>
<linearGradient id="cometg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#18f0ff" stop-opacity="0"/><stop offset=".7" stop-color="#18f0ff" stop-opacity=".8"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<radialGradient id="burstg"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#ffd400" stop-opacity="0"/></radialGradient>
<radialGradient id="blastg"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#ffcf4a"/><stop offset=".7" stop-color="#ff5a1f" stop-opacity=".7"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
<radialGradient id="halog"><stop offset="0" stop-color="#ffd400" stop-opacity=".55"/><stop offset="1" stop-color="#ffd400" stop-opacity="0"/></radialGradient>
<linearGradient id="framebev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
</defs>`);
  out.push(env);

  // ---- header
  const you = sc.viewSide;
  const m = { phase: sc.phase, turn: sc.turn };
  let status: string;
  if (sc.phase === Phase.Playing || sc.phase === Phase.PendingReveal) status = you >= 0 ? (sc.turn === you ? (sc.phase === Phase.PendingReveal ? "Revealing your defender" : "Your turn") : "Opponent's turn") : `Side ${sc.turn ? "B" : "A"} to move`;
  else if (sc.phase === Phase.Ended || sc.phase === Phase.Settled) status = sc.winner === 2 ? "Draw" : you >= 0 ? (sc.winner === you ? "You won" : "You lost") : `Side ${sc.winner ? "B" : "A"} won`;
  else if (sc.phase === Phase.Committing) status = "Placing armies";
  else if (sc.phase === Phase.Open) status = "Waiting for an opponent";
  else status = Phase[sc.phase] ?? "";
  void m;
  out.push(`<rect x="0" y="0" width="${W}" height="64" fill="#0b0b0d" fill-opacity=".82"/><rect x="0" y="64" width="${W}" height="3" fill="#ffd400"/>`);
  out.push(`<text x="24" y="41" font-size="26" font-weight="800" fill="#ffd400" letter-spacing="3">FOGLINE</text><text x="168" y="41" font-size="18" font-weight="500" fill="#e8e8e8">Match #${esc(sc.matchId)} · ply ${sc.ply}</text>`);
  const yourTurn = you >= 0 && sc.phase === Phase.Playing && sc.turn === you;
  out.push(`<text x="${W - 24}" y="41" text-anchor="end" font-size="20" font-weight="800" fill="${yourTurn ? "#ffd400" : "#ffffff"}">${esc(status)}</text>`);

  // ---- player strips
  const strip = (side: number, y: number) => {
    const look = sc.looks[side], glow = A.skinGlow(look.skin, side) as string;
    const who = you < 0 ? `Side ${side ? "B" : "A"}` : side === you ? "You" : "Opponent";
    const active = (sc.phase === Phase.Playing || sc.phase === Phase.PendingReveal) && sc.turn === side;
    const s: string[] = [];
    s.push(`<rect x="24" y="${y}" width="${W - 48}" height="52" rx="12" fill="#0b0b0d" fill-opacity=".72" stroke="${active ? glow : "#ffffff"}" stroke-opacity="${active ? 0.95 : 0.12}" stroke-width="${active ? 2.5 : 1}"/>`);
    s.push(piece({ sq: -1, side: side as 0 | 1, rank: null }, look, 34, y + 8, 36));
    s.push(`<text x="82" y="${y + 23}" font-size="17" font-weight="800" fill="#fff">${who}${active ? ` <tspan fill="${glow}">●</tspan>` : ""}</text>`);
    s.push(`<text x="82" y="${y + 42}" font-size="13" font-weight="500" fill="#bdbdbd">side ${side ? "B" : "A"}${sc.names?.[side] ? " · " + esc(sc.names[side]) : ""} · ${esc(SKIN_NAMES[look.skin] ?? "pieces")}</text>`);
    // pieces this side has lost, newest at the right
    const lost = sc.captured[side];
    if (lost.length) {
      const n = Math.min(lost.length, 14), sz = 30;
      const x0 = W - 36 - n * (sz + 2);
      s.push(`<text x="${x0 - 8}" y="${y + 31}" text-anchor="end" font-size="12" font-weight="500" fill="#9a9a9a">lost</text>`);
      lost.slice(-n).forEach((c, i) => s.push(piece(c, look, x0 + i * (sz + 2), y + 11, sz, false)));
    }
    return s.join("");
  };
  out.push(strip(top, 76));

  // ---- frame + coordinate band
  const fx0 = BX - BAND, fy0 = BY - BAND, fw = 8 * CELL + 2 * BAND;
  out.push(`<g filter="url(#dropsh)"><rect x="${fx0}" y="${fy0}" width="${fw}" height="${fw}" rx="10" fill="${T.frame}"/></g>`);
  out.push(`<rect x="${fx0}" y="${fy0}" width="${fw}" height="${fw}" rx="10" fill="url(#framebev)"/>`);
  out.push(`<rect x="${fx0}" y="${fy0}" width="${fw}" height="${fw}" rx="10" fill="#000" fill-opacity="${darkTable ? 0.35 : 0.5}"/>`);
  out.push(`<rect x="${fx0 + 3}" y="${fy0 + 3}" width="${fw - 6}" height="${fw - 6}" rx="8" fill="none" stroke="${T.frame}" stroke-opacity=".9" stroke-width="1.5"/>`);
  for (let i = 0; i < 8; i++) {
    const file = FILES[flip ? 7 - i : i], rank = String(flip ? i + 1 : 8 - i);
    const cx = BX + i * CELL + CELL / 2, cy = BY + i * CELL + CELL / 2 + 6;
    out.push(`<text x="${cx}" y="${fy0 + 20}" text-anchor="middle" font-size="16" font-weight="800" fill="${labelCol}">${file}</text>`);
    out.push(`<text x="${cx}" y="${BY + 8 * CELL + 20}" text-anchor="middle" font-size="16" font-weight="800" fill="${labelCol}">${file}</text>`);
    out.push(`<text x="${fx0 + BAND / 2}" y="${cy}" text-anchor="middle" font-size="16" font-weight="800" fill="${labelCol}">${rank}</text>`);
    out.push(`<text x="${BX + 8 * CELL + BAND / 2}" y="${cy}" text-anchor="middle" font-size="16" font-weight="800" fill="${labelCol}">${rank}</text>`);
  }

  // ---- squares
  for (let sq = 0; sq < 64; sq++) {
    const { x, y } = cellXY(sq, flip), r = Math.floor(sq / 8), c = sq % 8;
    out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${(r + c) % 2 ? T.light : T.dark}"/>`);
  }
  for (let i = 1; i < 8; i++) out.push(`<path d="M${BX + i * CELL} ${BY}V${BY + 8 * CELL}M${BX} ${BY + i * CELL}H${BX + 8 * CELL}" stroke="${T.line}" stroke-width="1"/>`);
  out.push(`<rect x="${BX}" y="${BY}" width="${8 * CELL}" height="${8 * CELL}" fill="none" stroke="${T.frame}" stroke-width="2"/>`);
  // small square names in the corner of each cell help agents and people read moves
  for (let sq = 0; sq < 64; sq++) {
    if (BLOCKED.has(sq)) continue;
    const { x, y } = cellXY(sq, flip);
    out.push(`<text x="${x + 5}" y="${y + 14}" font-size="10.5" font-weight="500" fill="${lum(T.label) > 0.45 ? "#ffffff" : "#000000"}" fill-opacity=".38">${FILES[sq % 8]}${Math.floor(sq / 8) + 1}</text>`);
  }
  for (const sq of BLOCKED) { const { x, y } = cellXY(sq, flip); out.push(fogbank(x, y, T.fogbank)); }

  // ---- previous move (fainter), then last move: from/to highlight, arrow, mover's trail
  const P = sc.prev;
  if (P && !(sc.last && (P.to === sc.last.from || P.to === sc.last.to || P.from === sc.last.to))) {
    const pl = sc.looks[P.side] ?? DEFAULT_LOOK, glow = A.skinGlow(pl.skin, P.side) as string;
    const a = cellXY(P.from, flip), b = cellXY(P.to, flip), ca = center(P.from, flip), cb = center(P.to, flip);
    out.push(`<g opacity=".6"><rect x="${a.x + 5}" y="${a.y + 5}" width="${CELL - 10}" height="${CELL - 10}" rx="8" fill="none" stroke="${glow}" stroke-width="2" stroke-dasharray="5 6"/><rect x="${b.x + 4}" y="${b.y + 4}" width="${CELL - 8}" height="${CELL - 8}" rx="9" fill="${glow}" fill-opacity=".10" stroke="${glow}" stroke-width="2.5"/>${trailFx(pl.trail, ca, cb)}${arrow(ca, cb, glow)}</g>`);
  }
  const L = sc.last;
  if (L) {
    const moverLook = sc.looks[L.side] ?? DEFAULT_LOOK, glow = A.skinGlow(moverLook.skin, L.side) as string;
    const a = cellXY(L.from, flip), b = cellXY(L.to, flip);
    out.push(`<rect x="${a.x + 4}" y="${a.y + 4}" width="${CELL - 8}" height="${CELL - 8}" rx="8" fill="${glow}" fill-opacity=".12" stroke="${glow}" stroke-width="2.5" stroke-dasharray="7 6"/>`);
    out.push(`<rect x="${b.x + 3}" y="${b.y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="9" fill="none" stroke="${glow}" stroke-width="7" filter="url(#ringglow)"/>`);
    out.push(`<rect x="${b.x + 3}" y="${b.y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="9" fill="${glow}" fill-opacity=".14" stroke="${glow}" stroke-width="3"/>`);
    const ca = center(L.from, flip), cb = center(L.to, flip);
    out.push(trailFx(moverLook.trail, ca, cb));
    out.push(moverLook.trail ? `<g opacity=".3">${arrow(ca, cb, glow)}</g>` : arrow(ca, cb, glow)); // let an owned trail show through
  }

  // ---- pieces
  const PS = 66, off = (CELL - PS) / 2;
  for (const c of sc.cells) { const { x, y } = cellXY(c.sq, flip); out.push(piece(c, sc.looks[c.side] ?? DEFAULT_LOOK, x + off, y + off, PS)); }

  // ---- effects for the last action (mover's equipped effects)
  if (P && P.attack && P.outcome !== undefined && !(L && L.to === P.to)) {
    const pl = sc.looks[P.side] ?? DEFAULT_LOOK;
    out.push(`<g opacity=".7">${captureFx(pl.fx, center(P.to, flip), A.skinGlow(pl.skin, P.side) as string, P.defenderRank === 8 ? "mine" : "capture")}</g>`);
  }
  if (L && L.attack) {
    const moverLook = sc.looks[L.side] ?? DEFAULT_LOOK, glow = A.skinGlow(moverLook.skin, L.side) as string;
    const kind = sc.phase >= Phase.Ended && sc.reason === 1 && L.defenderRank === 0 ? "beacon" : L.defenderRank === 8 ? "mine" : L.outcome !== undefined ? "capture" : "reveal";
    out.push(captureFx(moverLook.fx, center(L.to, flip), glow, kind));
  }

  out.push(strip(bottom, BY + 8 * CELL + BAND + 10));

  // ---- victory banner (winner's banner cosmetic)
  if ((sc.phase === Phase.Ended || sc.phase === Phase.Settled) && sc.winner !== 2) {
    const title = you < 0 ? `Side ${sc.winner ? "B" : "A"} wins` : sc.winner === you ? "Victory" : "Defeat";
    const sub = (END_REASONS[sc.reason] ?? "").replace(/([A-Z])/g, " $1").trim();
    out.push(banner(sc.looks[sc.winner]?.banner ?? 0, title, sub, W / 2, BY + 4 * CELL));
  } else if ((sc.phase === Phase.Ended || sc.phase === Phase.Settled) && sc.winner === 2) out.push(banner(0, "Draw", (END_REASONS[sc.reason] ?? "").replace(/([A-Z])/g, " $1").trim(), W / 2, BY + 4 * CELL));

  // ---- footer
  const legend = you >= 0 ? "Your pieces show their rank · enemy pieces stay hidden until revealed" : "Spectator view · hidden pieces stay hidden";
  out.push(`<rect x="0" y="${H - 50}" width="${W}" height="50" fill="#0b0b0d" fill-opacity=".85"/>`);
  out.push(`<text x="24" y="${H - 29}" font-size="12.5" font-weight="500" fill="#cfcfcf">${legend}</text>`);
  out.push(`<text x="24" y="${H - 12}" font-size="12" font-weight="500" fill="#8f8f8f">Rank pips: 1 Ghost · 2 Scout · 3 Sapper · 4 Guard · 5 Knight · 6 Captain · 7 Warden</text>`);
  out.push(`<text x="${W - 24}" y="${H - 29}" text-anchor="end" font-size="12.5" font-weight="800" fill="#ffd400">TapeLog</text>`);
  out.push(`<text x="${W - 24}" y="${H - 12}" text-anchor="end" font-size="11.5" font-weight="500" fill="#8f8f8f">Game for entertainment. Testnet only.</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

export { RANK_NAMES };
