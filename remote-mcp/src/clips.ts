// Highlight clips: short animated GIFs of captures and wins, rebuilt from the public onchain history
// (spectator view: hidden ranks stay hidden), plus a 1200x630 share card and an HTML share page with
// Open Graph / X card tags. Game for entertainment. Testnet only.
// @ts-ignore no types; gifenc (MIT) pure-JS GIF encoder
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { Phase, PIECES, RANK_NAMES } from "../../agent/src/rules";
import type { History, Snapshot } from "./history";
import type { LastAction } from "./render";

export type HighlightKind = "win" | "capture" | "mine" | "ambush" | "trade";
export interface Highlight { step: number; ply: number; kind: HighlightKind; title: string; detail: string; side: number }

const OUTC: Record<string, number> = { "attacker wins": 0, "defender holds": 1, "both removed": 2 };
const rankIdx = (n: string) => RANK_NAMES.indexOf(n);

/** The move/attack a snapshot shows, for drawing the last-move arrow and capture effects. */
export function actionOf(s: Snapshot): LastAction | undefined {
  const m = s.log.match(/^side (\d) (moves|ATTACKS) (\d+)->(\d+)/);
  const combat = s.log.match(/(\w+) vs (\w+): (attacker wins|defender holds|both removed)/);
  if (m) {
    const a: LastAction = { from: +m[3], to: +m[4], side: +m[1], attack: m[2] === "ATTACKS" };
    if (combat) { a.outcome = OUTC[combat[3]]; a.attackerRank = rankIdx(combat[1]); a.defenderRank = rankIdx(combat[2]); }
    return a;
  }
  const r = s.log.match(/^side (\d) reveals defender/);
  if (r && combat) return { from: Number(s.state.match.pendFrom), to: Number(s.state.match.pendTo), side: 1 - +r[1], attack: true, outcome: OUTC[combat[3]], attackerRank: rankIdx(combat[1]), defenderRank: rankIdx(combat[2]) };
  return undefined;
}

const SIDE = (s: number) => (s === 0 ? "Side A" : "Side B");
/** Captures, Mine blasts, Ghost ambushes and the winning moment of a match. */
export function findHighlights(h: History): Highlight[] {
  const out: Highlight[] = [];
  for (const s of h.snapshots) {
    const a = actionOf(s);
    if (a?.attack && a.outcome !== undefined && a.outcome !== 1) {
      const att = RANK_NAMES[a.attackerRank!], def = RANK_NAMES[a.defenderRank!];
      const beacon = a.defenderRank === 0;
      const kind: HighlightKind = beacon ? "win" : a.defenderRank === 8 ? (a.outcome === 0 ? "capture" : "mine") : a.attackerRank === 1 && a.defenderRank === 7 ? "ambush" : a.outcome === 2 ? "trade" : "capture";
      const title = beacon ? "Beacon captured!" : kind === "mine" ? `Mine blast: ${att} lost` : kind === "ambush" ? "Ghost ambush on the Warden!" : a.defenderRank === 8 ? "Sapper defuses a Mine" : `${att} takes ${def}`;
      out.push({ step: s.step, ply: Number(s.state.match.ply), kind, title, detail: `${SIDE(a.side)}'s ${att} attacked ${SIDE(1 - a.side)}'s ${def}`, side: a.side });
    }
  }
  // a win that was not a Beacon capture (resign, timeout, ...): the end of the match
  const endIdx = h.snapshots.findIndex((s) => Number(s.state.match.phase) >= Phase.Ended && Number(s.state.match.winner) < 2);
  if (endIdx >= 0 && !out.some((x) => x.kind === "win")) {
    const s = h.snapshots[endIdx], w = Number(s.state.match.winner), reason = Number(s.state.match.reason);
    const L = SIDE(1 - w);
    const why = ["", `${L}'s Beacon was captured`, `${L} resigned`, `${L}'s turn timer ran out`, "", "", "", `${L} made an illegal reveal`, `${L}'s army could not be verified`][reason] || "Match over";
    out.push({ step: s.step, ply: Number(s.state.match.ply), kind: "win", title: `${SIDE(w)} wins`, detail: why, side: w });
  }
  return out;
}

/** Steps to animate for a highlight: up to `before` real moves leading to it, then the moment itself. */
export function clipSteps(h: History, step: number, before = 6): Snapshot[] {
  const idx = h.snapshots.findIndex((s) => s.step === step);
  if (idx < 0) return [];
  const frames: Snapshot[] = [];
  for (let i = idx; i >= 0 && frames.length < before + 1; i--) {
    const s = h.snapshots[i];
    const playing = Number(s.state.match.phase) >= Phase.Playing && s.state.board.some((x: number) => Number(x) > 0);
    if (!playing) break;
    if (i === idx || actionOf(s)) frames.unshift(s);
  }
  return frames;
}

/** Encode RGBA frames into a looping GIF with one shared palette; unchanged pixels become transparent (small files). */
export function encodeGif(frames: Uint8Array[], width: number, height: number, delays: number[]): Uint8Array {
  // shared palette from a sample of every frame (every 7th pixel), 255 colours + 1 transparent
  const n = width * height, sample = new Uint8Array(Math.ceil(n / 7) * 4 * frames.length);
  let k = 0;
  for (const f of frames) for (let p = 0; p < n; p += 7) { sample[k++] = f[p * 4]; sample[k++] = f[p * 4 + 1]; sample[k++] = f[p * 4 + 2]; sample[k++] = 255; }
  const palette = quantize(sample.subarray(0, k), 255, { format: "rgb565" });
  const TR = palette.length;
  palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  let prev: Uint8Array | undefined;
  frames.forEach((f, i) => {
    const idx = applyPalette(f, palette, "rgb565") as Uint8Array;
    let out = idx;
    if (prev) { out = new Uint8Array(idx); for (let p = 0; p < n; p++) if (idx[p] === prev[p]) out[p] = TR; }
    gif.writeFrame(out, width, height, { palette: i === 0 ? palette : undefined, delay: delays[i], repeat: 0, transparent: i > 0, transparentIndex: TR, dispose: 1 });
    prev = idx;
  });
  gif.finish();
  return gif.bytes();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** 1200x630 share card (X / Open Graph): the key frame plus the headline. */
export function cardSvg(o: { frame: string; title: string; detail: string; matchId: string; names: [string, string]; ply: number }) {
  const W = 1200, H = 630, bw = Math.round(630 * 800 / 950);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15130e"/><stop offset="1" stop-color="#0b0b0d"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<image x="0" y="0" width="${bw}" height="${H}" href="${o.frame}"/>
<rect x="${bw}" y="0" width="6" height="${H}" fill="#ffd400"/>
<text x="${bw + 48}" y="92" font-size="30" font-weight="800" fill="#ffd400" letter-spacing="4">FOGLINE</text>
<text x="${bw + 48}" y="124" font-size="18" font-weight="500" fill="#9a9a9a">Match #${esc(o.matchId)} · ply ${o.ply} · highlight</text>
${wrap(o.title, 20).map((l, i) => `<text x="${bw + 48}" y="${212 + i * 58}" font-size="50" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join("")}
${wrap(o.detail, 44).map((l, i) => `<text x="${bw + 48}" y="${352 + i * 30}" font-size="22" font-weight="500" fill="#d8d8d8">${esc(l)}</text>`).join("")}
<text x="${bw + 48}" y="${452}" font-size="19" font-weight="500" fill="#bdbdbd">Side A: ${esc(o.names[0] || "—")}</text>
<text x="${bw + 48}" y="${482}" font-size="19" font-weight="500" fill="#bdbdbd">Side B: ${esc(o.names[1] || "—")}</text>
<rect x="${bw + 48}" y="${516}" width="226" height="46" rx="10" fill="#ffd400"/><text x="${bw + 161}" y="${546}" text-anchor="middle" font-size="19" font-weight="800" fill="#111">▶ Watch the clip</text>
<text x="${W - 32}" y="${H - 24}" text-anchor="end" font-size="15" font-weight="500" fill="#8f8f8f">TapeLog · Game for entertainment. Testnet only.</text>
</svg>`;
}
function wrap(s: string, n: number): string[] {
  const words = s.split(/\s+/), lines: string[] = [];
  let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** HTML share page: X / Open Graph tags point at the card; the page plays the GIF. */
export function sharePage(origin: string, o: { matchId: string; step: number; title: string; detail: string; names: [string, string]; watch: string }) {
  const base = `${origin}/clip/${o.matchId}/${o.step}`;
  const title = `${o.title} · Fogline match #${o.matchId}`;
  const desc = `${o.detail}. ${o.names[0] || "Side A"} vs ${o.names[1] || "Side B"} on Fogline, the hidden-army strategy game (Base Sepolia testnet).`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="video.other"><meta property="og:site_name" content="Fogline by TapeLog">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${base}">
<meta property="og:image" content="${base}/card.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(o.title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${base}/card.png"><meta name="twitter:image:alt" content="${esc(o.title)}">
<style>body{margin:0;background:#0b0b0b;color:#f4f4f4;font:15px/1.5 system-ui,sans-serif;text-align:center}main{max-width:560px;margin:0 auto;padding:18px}img{width:100%;height:auto;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6)}h1{font-size:22px;margin:10px 0 2px}a{color:#ffd400}.tag{color:#8a8a8a}.row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:12px 0}.btn{background:#ffd400;color:#111;font-weight:700;text-decoration:none;padding:8px 14px;border-radius:8px}.ghost{border:1px solid #333;color:#f4f4f4;text-decoration:none;padding:8px 14px;border-radius:8px}</style></head>
<body><main><h1>${esc(o.title)}</h1><div class="tag">${esc(o.detail)} · match #${esc(o.matchId)}</div>
<p><img src="${base}.gif" width="420" height="499" alt="${esc(o.title)} (animated clip)"></p>
<div class="row"><a class="btn" href="https://tapelog-journal.github.io/fogline/play.html">▶ Play Fogline</a><a class="ghost" href="${esc(o.watch)}">Watch the full replay</a><a class="ghost" href="${base}.gif" download>Download GIF</a>
<a class="ghost" href="https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(base)}">Share on X</a></div>
<p class="tag">Spectator view: hidden pieces stay hidden. TapeLog · Game for entertainment. Testnet only. Not investment advice.</p></main></body></html>`;
}

export { PIECES };
