// Renders sample boards locally (Node + resvg-wasm) for visual checks and timing.
// Usage: node test/render-preview.mjs [outDir]
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
const out = process.argv[2] ?? "/tmp/fogline-render";
mkdirSync(out, { recursive: true });
await build({ entryPoints: ["src/render.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/fogline-render-bundle.mjs", logLevel: "error" });
const R = await import("/tmp/fogline-render-bundle.mjs?" + Date.now());
await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const fonts = [readFileSync("assets/inter-500.ttf"), readFileSync("assets/inter-800.ttf")];
export function png(svg) {
  const t = performance.now();
  const r = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Inter", sansSerifFamily: "Inter", serifFamily: "Inter", monospaceFamily: "Inter" }, fitTo: { mode: "original" } });
  const b = r.render().asPng();
  return { b, ms: performance.now() - t };
}
// a mid-game position
const rnd = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
const cells = [];
const ranksA = [8, 0, 8, 4, 2, 4, 3, 2, 5, 7, 2, 6, 1, 3, 4, 5];
for (let i = 0; i < 16; i++) cells.push({ sq: i < 8 ? i : i + (i % 3 === 0 ? 8 : 0), side: 0, rank: ranksA[i] });
for (let i = 0; i < 16; i++) cells.push({ sq: 48 + i - (i % 4 === 1 ? 8 : 0), side: 1, rank: i === 5 ? 6 : null });
const scenes = {
  player: { matchId: "15", ply: 14, phase: 3, turn: 0, winner: 2, reason: 0, viewSide: 0, cells: cells.filter((c) => c.sq !== 27), captured: [[{ sq: -1, side: 0, rank: 2 }], [{ sq: -1, side: 1, rank: 4 }, { sq: -1, side: 1, rank: 8 }]],
    last: { from: 45, to: 29, side: 1, attack: false }, prev: { from: 27 - 8, to: 27, side: 0, attack: true, outcome: 0, attackerRank: 5, defenderRank: 4 }, names: ["0x8788…D66e", "TapeLog bot"], looks: [{ skin: 6, table: 9, fog: 20, trail: 17, banner: 21, fx: [13, 14, 15, 16] }, { skin: 5, table: 10, fog: 19, trail: 18, banner: 22, fx: [13] }] },
  spectator: { matchId: "15", ply: 14, phase: 3, turn: 0, winner: 2, reason: 0, viewSide: -1, cells: cells.map((c) => ({ ...c, rank: c.rank === 6 && c.side === 1 ? 6 : null })), captured: [[{ sq: -1, side: 0, rank: 2 }], []], last: { from: 12, to: 20, side: 0, attack: false }, looks: [{ skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] }, { skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] }] },
};
for (const t of (process.env.TABLES ?? "").split(",").filter(Boolean)) scenes["t" + t] = { ...scenes.player, viewSide: 1, looks: [{ ...scenes.player.looks[0] }, { skin: [1, 2, 7, 8, 0, 5, 6][t % 7], table: +t, fog: 0, trail: 18, banner: 22, fx: [13] }] };
for (const [k, sc] of Object.entries(scenes)) {
  const svg = R.boardSvg(sc);
  writeFileSync(`${out}/${k}.svg`, svg);
  png(svg); // warm
  const { b, ms } = png(svg);
  writeFileSync(`${out}/${k}.png`, b);
  console.log(k, `${ms.toFixed(0)}ms`, `${(b.length / 1024).toFixed(0)}KB`, `svg ${(svg.length / 1024).toFixed(0)}KB`);
}
