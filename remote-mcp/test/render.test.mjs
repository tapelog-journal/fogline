// Unit tests for the board picture renderer: fog of war, uniform grid, coordinates, cosmetics, PNG output.
// Run: node --test test/render.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

await build({ entryPoints: { render: "src/render.ts", cosmetics: "test/cosmetics-entry.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error", external: ["viem", "viem/*"] });
const R = await import("./.build/render.js");
const C = await import("./.build/cosmetics.js");
await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));

const LOOKS = () => [{ skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] }, { skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] }];
// a fake mid-game state: side 0 on squares 0..15, side 1 on 48..63; piece 17 (side 1) revealed as Captain
const RANKS = [8, 0, 8, 4, 2, 4, 3, 2, 5, 7, 2, 6, 1, 3, 4, 5];
function state() {
  const board = Array(64).fill(0), pieces = [];
  for (let pid = 0; pid < 32; pid++) {
    const pos = pid < 16 ? pid : 48 + (pid - 16);
    board[pos] = pid + 1;
    pieces.push({ commitment: "0x", pos, rank: 0, alive: true, revealed: false, moved: false });
  }
  pieces[17].revealed = true; pieces[17].rank = 6;
  pieces[20].alive = false; pieces[20].revealed = true; pieces[20].rank = 4; board[52] = 0;
  return { id: 15n, board, pieces, match: { players: ["0x" + "a".repeat(40), "0x" + "b".repeat(40)], phase: 3, turn: 0, winner: 2, reason: 0, ply: 12, pendFrom: 0, pendTo: 0, committed: [true, true], verified: [false, false] } };
}
const layoutA = { ranks: RANKS, salts: [] };
const layoutB = { ranks: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7], salts: [] }; // never used for other viewers

test("spectator view reveals nothing that is hidden onchain", () => {
  const sc = R.sceneFrom(state(), -1, layoutA, LOOKS());
  const known = sc.cells.filter((c) => c.rank !== null);
  assert.deepEqual(known.map((c) => [c.sq, c.rank]), [[49, 6]]);
  assert.deepEqual(sc.captured[1].map((c) => c.rank), [4]);
});

test("player view shows own ranks only; enemy stays hidden unless revealed", () => {
  const sc = R.sceneFrom(state(), 0, layoutA, LOOKS());
  for (const c of sc.cells) {
    if (c.side === 0) assert.equal(c.rank, RANKS[c.sq]);
    else assert.equal(c.rank, c.sq === 49 ? 6 : null);
  }
  const scB = R.sceneFrom(state(), 1, layoutB, LOOKS());
  assert.ok(scB.cells.filter((c) => c.side === 0).every((c) => c.rank === null), "side B must not see side A ranks");
});

test("hidden pieces leave no rank glyph in the SVG", () => {
  const WARDEN = "M27 68V39l12 12"; // Warden glyph path
  const spect = R.boardSvg(R.sceneFrom(state(), -1, layoutA, LOOKS()));
  assert.ok(!spect.includes(WARDEN), "spectator SVG leaked a Warden");
  const asB = R.boardSvg(R.sceneFrom(state(), 1, layoutB, LOOKS()));
  assert.ok(asB.includes(WARDEN), "own Wardens should be drawn for side B (layoutB is all Wardens)");
  const asA = R.boardSvg(R.sceneFrom(state(), 0, layoutA, LOOKS()));
  assert.equal(asA.split(WARDEN).length - 1, 1, "side A sees exactly its one Warden");
});

test("grid is 8x8 whole-pixel uniform cells", () => {
  const svg = R.boardSvg(R.sceneFrom(state(), 0, layoutA, LOOKS()));
  const cells = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="rgba/g)].map((m) => m.slice(1).map(Number));
  assert.equal(cells.length, 64);
  assert.ok(cells.every(([, , w, h]) => w === R.CELL && h === R.CELL));
  const xs = [...new Set(cells.map((c) => c[0]))].sort((a, b) => a - b), ys = [...new Set(cells.map((c) => c[1]))].sort((a, b) => a - b);
  assert.equal(xs.length, 8); assert.equal(ys.length, 8);
  for (let i = 1; i < 8; i++) { assert.equal(xs[i] - xs[i - 1], R.CELL); assert.equal(ys[i] - ys[i - 1], R.CELL); }
});

test("a-h / 1-8 edge labels, flipped for side B", () => {
  const files = (svg) => [...svg.matchAll(/font-size="16" font-weight="800" fill="[^"]+">([a-h1-8])</g)].map((m) => m[1]);
  const a = files(R.boardSvg(R.sceneFrom(state(), 0, layoutA, LOOKS())));
  const b = files(R.boardSvg(R.sceneFrom(state(), 1, layoutB, LOOKS())));
  assert.equal(a.length, 32);
  assert.deepEqual(a.filter((_, i) => i % 4 === 0), [..."abcdefgh"]);
  assert.deepEqual(b.filter((_, i) => i % 4 === 0), [..."hgfedcba"]);
  assert.deepEqual(a.filter((_, i) => i % 4 === 2), [..."87654321"]);
  assert.deepEqual(b.filter((_, i) => i % 4 === 2), [..."12345678"]);
});

test("equipped cosmetics win their category; other categories use best owned", () => {
  const look = C.lookFrom({ owned: [1, 6, 9, 10, 13, 15, 17, 20], equipped: [1, 9] });
  assert.equal(look.skin, 1);   // equipped Tape Neon beats owned Legendary Obsidian
  assert.equal(look.table, 9);  // equipped War-Room Oak beats owned Epic Deep-Space
  assert.equal(look.fog, 20); assert.equal(look.trail, 17);
  assert.deepEqual(look.fx, [13, 15]);
  assert.equal(C.lookFrom({ owned: [], equipped: [6, 0] }).skin, 0, "equipping something not owned is ignored");
});

test("renders a PNG of the expected size", () => {
  const svg = R.boardSvg({ ...R.sceneFrom(state(), 0, layoutA, LOOKS()), last: { from: 9, to: 17, side: 0, attack: false } });
  const r = new Resvg(svg, { font: { fontBuffers: [readFileSync("assets/inter-500.ttf"), readFileSync("assets/inter-800.ttf")], defaultFontFamily: "Inter" } });
  const img = r.render();
  assert.equal(img.width, R.W); assert.equal(img.height, R.H);
  const png = img.asPng();
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
