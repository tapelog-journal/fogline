// Bracket logic for tournaments. Run: node --test test/tourney.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: { tcore: "src/tourney-core.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error" });
const T = await import("./.build/tcore.js");
const human = (i, rating = 1200) => ({ address: "0x" + String(i).padStart(40, "0"), name: "p" + i, client: "browser", rating, joinedAt: i });

test("weekly start is the next Sunday 18:00 UTC (today if before 18:00 on a Sunday)", () => {
  assert.equal(new Date(T.weeklyStart(Date.UTC(2026, 9, 18, 12, 30))).toISOString(), "2026-10-18T18:00:00.000Z");
  assert.equal(new Date(T.weeklyStart(Date.UTC(2026, 9, 18, 18, 30))).toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(new Date(T.weeklyStart(Date.UTC(2026, 9, 21, 9))).toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(T.isoWeek(Date.UTC(2026, 9, 18, 18)), "2026-W42");
});
test("seed order pairs 1v8, 4v5, 2v7, 3v6", () => { assert.deepEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]); });
test("no sign-ups: cancelled", () => {
  const t = T.startBracket(T.newWeekly(Date.UTC(2026, 9, 18, 12), 1), Date.UTC(2026, 9, 18, 18));
  assert.equal(t.status, "cancelled");
});
test("one human vs the Hard bot in a final", () => {
  const t0 = T.newWeekly(0, 1); t0.entrants = [human(1)];
  const t = T.startBracket(t0, 1);
  assert.equal(t.rounds.length, 1); assert.equal(t.entrants[1].bot, "hard");
  const done = T.recordResult(t, 0, 0, 0, 2);
  assert.equal(done.status, "done"); assert.equal(done.champion, 0); assert.equal(done.runnerUp, 1);
});
test("3 humans: best seed meets a bot; bots fill to 4; winners advance to a final", () => {
  const t0 = T.newWeekly(0, 1); t0.entrants = [human(1, 1100), human(2, 1300), human(3, 1250)];
  let t = T.startBracket(t0, 1);
  assert.equal(t.entrants[0].name, "p2"); assert.equal(t.entrants.length, 4); assert.equal(t.entrants[3].bot, "hard");
  assert.deepEqual(t.rounds[0].map((p) => [p.a, p.b]), [[0, 3], [1, 2]]);
  t = T.recordResult(t, 0, 0, 1, 2); // the bot beats seed 1
  t = T.recordResult(t, 0, 1, 2, 3); // draw: better seed (index 1) advances
  assert.equal(t.rounds.length, 2); assert.deepEqual([t.rounds[1][0].a, t.rounds[1][0].b], [3, 1]);
  assert.match(t.rounds[0][1].note, /better seed/);
  t = T.recordResult(t, 1, 0, 1, 4);
  assert.equal(t.status, "done"); assert.equal(t.champion, 1);
});
test("bots never play each other: higher level advances automatically", () => {
  const t0 = T.newWeekly(0, 1); t0.entrants = [human(1)]; t0.maxHumans = 16;
  // force a bigger bracket with mostly bots
  t0.entrants.push(human(2), human(3), human(4), human(5));
  let t = T.startBracket(t0, 1); // 5 humans -> 8 slots, 3 bots (hard, normal, easy)
  assert.equal(t.entrants.length, 8);
  assert.ok(t.rounds[0].every((p) => !(t.entrants[p.a].bot && t.entrants[p.b].bot)), "round 1 pairs humans with bots first");
  // let all bots win round 1, then the bot-vs-bot pairing in round 2 resolves itself
  t.rounds[0].forEach((p, i) => { const botSide = t.entrants[p.b].bot ? 1 : t.entrants[p.a].bot ? 0 : 0; t = T.recordResult(t, 0, i, botSide, 2); });
  const r2 = t.rounds[1];
  const auto = r2.filter((p) => p.status === "done" && /bots don't play/.test(p.note ?? ""));
  assert.ok(auto.length >= 1);
});
test("adjudication by pieces left", () => { assert.equal(T.adjudicate([10, 8]), 0); assert.equal(T.adjudicate([7, 9]), 1); assert.equal(T.adjudicate([5, 5]), 2); });

test("cups every 4 hours UTC; sign-ups close 5 minutes before", () => {
  const at = (h, m = 0) => Date.UTC(2026, 9, 19, h, m);
  assert.equal(new Date(T.cupStart(at(1, 0))).toISOString(), "2026-10-19T04:00:00.000Z");
  assert.equal(new Date(T.cupStart(at(3, 54))).toISOString(), "2026-10-19T04:00:00.000Z");
  assert.equal(new Date(T.cupStart(at(3, 56))).toISOString(), "2026-10-19T08:00:00.000Z");
  assert.equal(new Date(T.cupStart(at(22, 0))).toISOString(), "2026-10-20T00:00:00.000Z");
  const c = T.newCup(at(1), 3);
  assert.equal(c.id, "cup-2026-10-19T04"); assert.equal(c.maxHumans, 8); assert.equal(c.turnTimeout, 60);
  assert.equal(T.signupClosesAt(c), at(3, 55));
  assert.ok([0, 4, 8, 12, 16, 20].every((h) => T.isExhibitionSlot(at(h))) && !T.isExhibitionSlot(at(5)));
});
test("an open weekly becomes a 16-player Sunday Major", () => {
  const w = T.newWeekly(Date.UTC(2026, 9, 19), 2);
  const m = T.asMajor(w);
  assert.equal(m.kind, "major"); assert.equal(m.name, "Fogline Sunday Major (Weekly #2)"); assert.equal(m.maxHumans, 16); assert.equal(m.startsAt, w.startsAt);
});
test("empty cup: skipped without personas, exhibition with them (bots play each other, no prizes)", () => {
  const c = T.newCup(Date.UTC(2026, 9, 19, 1), 1);
  assert.equal(T.startBracket(c, c.startsAt, { skipNote: "x" }).status, "skipped");
  const lv = ["hard", "hard", "normal", "normal", "normal", "easy", "easy", "easy"];
  const ps = lv.map((l, i) => ({ address: "0xb" + String(i).padStart(39, "0"), name: "P" + i, client: "house", rating: 0, bot: l, persona: "p" + i, joinedAt: i }));
  let t = T.startBracket(c, c.startsAt, { personas: ps });
  assert.equal(t.status, "running"); assert.ok(t.exhibition); assert.equal(t.prizes.length, 0); assert.equal(t.maxPlies, T.EXHIBITION_MAX_PLIES);
  assert.equal(t.rounds[0].length, 4); assert.ok(t.rounds[0].every((p) => p.status === "waiting")); // nothing auto-advanced
  assert.equal(t.entrants[0].bot, "hard"); assert.equal(t.entrants[7].bot, "easy");
  for (let r = 0; r < 3; r++) t.rounds[r].forEach((_, i) => { t = T.recordResult(t, r, i, 0, c.startsAt + 1); });
  assert.equal(t.status, "done"); assert.equal(t.champion, 0);
});
test("cup with one player: house bots fill and never play each other", () => {
  const c = { ...T.newCup(Date.UTC(2026, 9, 19, 1), 1), entrants: [human(1)] };
  const t = T.startBracket(c, c.startsAt);
  assert.equal(t.entrants.length, 2); assert.ok(!t.exhibition); assert.equal(t.rounds[0][0].status, "waiting");
});
