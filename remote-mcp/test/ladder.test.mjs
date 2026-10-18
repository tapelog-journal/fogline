// Elo math for the ladder. Run: node --test test/ladder.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: { elo: "src/elo.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error" });
const { elo, START_RATING } = await import("./.build/elo.js");

test("equal players: winner +20, loser -20 (K=40 provisional)", () => {
  assert.deepEqual(elo(START_RATING, START_RATING, 1, 0, 0), [1220, 1180]);
  assert.deepEqual(elo(START_RATING, START_RATING, 0, 0, 0), [1180, 1220]);
});
test("draw between equals changes nothing; upset moves more than expected win", () => {
  assert.deepEqual(elo(1300, 1300, 0.5, 20, 20), [1300, 1300]);
  const [up] = elo(1100, 1500, 1, 20, 20), [fav] = elo(1500, 1100, 1, 20, 20);
  assert.ok(up - 1100 > fav - 1500 && fav - 1500 >= 0);
});
test("established players use K=24", () => {
  assert.deepEqual(elo(1400, 1400, 1, 30, 30), [1412, 1388]);
});
