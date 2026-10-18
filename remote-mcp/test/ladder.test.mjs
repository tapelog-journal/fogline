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

// bot levels (pure rules sim)
const { playGame } = await import("./levels-sim.mjs");
const lv = await import("./.build/levels.js");
test("parseLevel accepts easy/normal/hard, defaults to normal, rejects junk", () => {
  assert.equal(lv.parseLevel(undefined), "normal"); assert.equal(lv.parseLevel("HARD"), "hard"); assert.throws(() => lv.parseLevel("insane"));
});
test("hard inference respects moved pieces and composition", () => {
  const rules = { PIECES: 16 };
  const pieces = Array.from({ length: 32 }, (_, pid) => ({ pos: pid < 16 ? pid : 32 + pid, rank: 0, alive: true, revealed: false, moved: pid === 20, commitment: "" }));
  const inf = lv.inferRanks({ board: [], pieces, match: {} }, 0);
  assert.equal(inf.size, 16);
  assert.ok(inf.get(20)[0] < 1e-9 && inf.get(20)[8] < 1e-9, "moved piece is never Beacon/Mine");
  const beaconMass = [...inf.values()].reduce((a, d) => a + d[0], 0);
  assert.ok(Math.abs(beaconMass - 1) < 1e-6, "exactly one Beacon in expectation");
});
test("hard beats normal and easy in offline self-play", () => {
  let hard = 0; for (let g = 0; g < 40; g++) { const r = playGame(g % 2 ? "normal" : "hard", g % 2 ? "hard" : "normal"); if (r.winner === (g % 2 ? 1 : 0)) hard++; }
  assert.ok(hard >= 24, `hard won ${hard}/40 vs normal`);
});
