// Highlight detection + GIF encoding. Run: node --test test/clips.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: { clips: "src/clips.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error" });
const C = await import("./.build/clips.js");
const st = (phase, ply, extra = {}) => ({ match: { phase, ply, winner: 2, reason: 0, pendFrom: 9, pendTo: 17, ...extra }, board: [1, 0, 2], pieces: [] });
const hist = {
  done: true, players: ["0x" + "1".repeat(40), "0x" + "2".repeat(40)],
  snapshots: [
    { step: 1, log: "match created", state: st(1, 0) },
    { step: 2, log: "side 0 moves 9->17 [b2→b3]", state: st(3, 1) },
    { step: 3, log: "side 1 ATTACKS 50->42 [c7→c6]", state: st(4, 2) },
    { step: 4, log: "side 0 reveals defender Guard -> Knight vs Guard: attacker wins", state: st(3, 3, { pendFrom: 50, pendTo: 42 }) },
    { step: 5, log: "side 0 ATTACKS 17->25 [b3→b4]: Scout vs Mine: defender holds", state: st(3, 4) },
    { step: 6, log: "side 1 ATTACKS 42->34 [c6→c5]: Ghost vs Warden: attacker wins", state: st(3, 5) },
    { step: 7, log: "side 1 ATTACKS 34->26 [c5→c4]: Knight vs Mine: both removed", state: st(3, 6) },
    { step: 8, log: "side 0 resigns", state: st(5, 6, { winner: 1, reason: 2 }) },
  ],
};
test("reveal-defender snapshots map back to the attack", () => {
  assert.deepEqual(C.actionOf(hist.snapshots[3]), { from: 50, to: 42, side: 1, attack: true, outcome: 0, attackerRank: 5, defenderRank: 4 });
  assert.equal(C.actionOf(hist.snapshots[0]), undefined);
});
test("captures, ambush, mine blast and resign win are highlights; a failed attack is not", () => {
  const h = C.findHighlights(hist);
  assert.deepEqual(h.map((x) => [x.step, x.kind]), [[4, "capture"], [6, "ambush"], [7, "mine"], [8, "win"]]);
  assert.match(h[3].title, /Side B wins/);
  assert.match(h[3].detail, /resigned/);
});
test("a clip covers the moves leading up to the moment", () => {
  assert.deepEqual(C.clipSteps(hist, 6, 3).map((s) => s.step), [3, 4, 5, 6]);
  assert.deepEqual(C.clipSteps(hist, 2).map((s) => s.step), [2]);
});
test("GIF encoder makes a valid looping animated GIF", () => {
  const w = 8, h = 6, f = (r) => { const a = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { a[i * 4] = i < 10 ? r : 30; a[i * 4 + 3] = 255; } return a; };
  const g = C.encodeGif([f(10), f(200), f(90)], w, h, [500, 500, 2000]);
  assert.equal(Buffer.from(g.subarray(0, 6)).toString(), "GIF89a");
  assert.ok(Buffer.from(g).includes(Buffer.from("NETSCAPE2.0")));
  assert.equal(g[g.length - 1], 0x3b);
});
test("share page has X / Open Graph tags and the footer", () => {
  const p = C.sharePage("https://x.test", { matchId: "7", step: 6, title: "Ghost ambush", detail: "d", names: ["a", "b"], watch: "https://w" });
  for (const t of ['property="og:image" content="https://x.test/clip/7/6/card.png"', 'name="twitter:card" content="summary_large_image"', "Game for entertainment. Testnet only."]) assert.ok(p.includes(t), t);
});
