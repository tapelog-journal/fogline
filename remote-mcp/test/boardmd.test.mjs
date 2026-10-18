// Unit tests for the compact text board (board_md): fits a narrow chat pane, coordinates, fog of war, last move.
// Run: node --test test/boardmd.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

await build({ entryPoints: { view: "src/view.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error", external: ["viem", "viem/*"] });
const V = await import("./.build/view.js");

const RANKS = [8, 0, 8, 4, 2, 4, 3, 2, 5, 7, 2, 6, 1, 3, 4, 5];
export function sample() {
  const board = Array(64).fill(0), pieces = [];
  for (let pid = 0; pid < 32; pid++) {
    const pos = pid < 16 ? pid : 48 + (pid - 16);
    board[pos] = pid + 1;
    pieces.push({ commitment: "0x", pos, rank: 0, alive: true, revealed: false, moved: false });
  }
  pieces[17].revealed = true; pieces[17].rank = 6;
  // side 0 Scout (pid 10, b2? -> square 10 = c2) moved c2 -> c3
  board[10] = 0; board[18] = 11; pieces[10].pos = 18;
  return { s: { board, pieces }, layout: { ranks: RANKS, salts: [] }, last: { from: 10, to: 18 } };
}

test("compact board: 8 columns, short cells, no emoji", () => {
  const { s, layout, last } = sample();
  const md = V.boardMd(s, 0, layout, last);
  const lines = md.split("\n");
  assert.equal(lines.length, 10);
  assert.equal(lines[0], "| |a|b|c|d|e|f|g|h|");
  for (const l of lines.slice(2)) {
    const cells = l.split("|").slice(1, -1);
    assert.equal(cells.length, 9, l);
    for (const c of cells) assert.ok(c.length >= 1 && c.length <= 3, `cell "${c}" in ${l}`);
  }
  assert.ok(!/[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/u.test(md), "no emoji");
  assert.ok(Math.max(...lines.filter((_, i) => i !== 1).map((l) => l.length)) <= 30, "short rows");
});

test("compact board: ranks, fog of war, fog banks, last move", () => {
  const { s, layout, last } = sample();
  const rows = Object.fromEntries(V.boardMd(s, 0, layout, last).split("\n").slice(2).map((l) => { const c = l.split("|").slice(1, -1); return [c[0], c.slice(1)]; }));
  assert.deepEqual(rows["1"], ["M", "B", "M", "4", "2", "4", "3", "2"]);
  assert.equal(rows["2"][2], "o", "came-from marker on c2");
  assert.equal(rows["3"][2], "2*", "Scout landed on c3, marked");
  assert.equal(rows["4"][2], "~", "fog bank c4");
  assert.equal(rows["5"][5], "~", "fog bank f5");
  assert.equal(rows["7"][1], "e6", "revealed enemy Captain on b7");
  assert.ok(rows["8"].every((c) => c === "?") && rows["7"].filter((c) => c === "?").length === 7, "hidden enemies are ?");
  assert.equal(rows["6"].join(""), "········");
});

test("compact board: side B sees it rotated and never sees side A's hidden ranks", () => {
  const { s } = sample();
  const md = V.boardMd(s, 1, { ranks: Array(16).fill(7), salts: [] });
  const lines = md.split("\n");
  assert.equal(lines[0], "| |h|g|f|e|d|c|b|a|");
  assert.ok(lines[2].startsWith("|1|"));
  assert.ok(lines[2].split("|").slice(2, -1).every((c) => c === "?"), "side A pieces hidden from side B");
  assert.ok(!md.includes("e6"));
  mkdirSync("test/.build", { recursive: true });
  writeFileSync("test/.build/board-sample.md", V.boardMd(sample().s, 0, sample().layout, sample().last) + "\n\n" + V.MD_LEGEND + "\n");
});
