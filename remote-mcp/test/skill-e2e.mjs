// Plays a full match vs the house bot using ONLY the skill.md instructions and plain HTTP GETs.
// Usage: node test/skill-e2e.mjs [skillUrl]   (FOGLINE_RESOLVE_IP pins *.workers.dev to an IP if needed)
import { Agent, fetch as ufetch } from "undici";
const skillUrl = process.argv[2] ?? "https://fogline-mcp.tapelog.workers.dev/skill.md";
const pin = process.env.FOGLINE_RESOLVE_IP;
const dispatcher = pin ? new Agent({ connect: { lookup: (h, o, cb) => (h.endsWith("workers.dev") ? cb(null, [{ address: pin, family: 4 }]) : cb(null, [{ address: "0.0.0.0", family: 4 }])) } }) : undefined;
const get = async (u) => { const r = await ufetch(u, { dispatcher: u.includes("workers.dev") ? dispatcher : undefined, headers: { "user-agent": "fogline-skill-e2e/1.0" } }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const skill = await get(skillUrl);
const base = skill.match(/API base: `([^`]+)`/)[1];
const newPlayer = skill.match(/`(https:\/\/[^`]+\/api\/new-player)`/)[1];
log("skill.md read; API base", base);
const np = await get(newPlayer);
if (!np.ok) throw new Error(np.error);
log("new-player:", np.text);
let r = await get(np.next.playBot);
log("play-bot:", r.text);
const watch = r.watch, matchId = r.matchId;
const again = await get(np.next.playBot); log("play-bot again (idempotent):", again.matchId === matchId ? "same match, reused" : "DIFFERENT " + again.matchId);
r = await get(r.next.autoArmy);
log("auto-army:", r.text); console.log(r.board);
let moves = 0, staleChecked = false;
while (r.phase !== "Settled" && moves < 200) {
  if (!r.ok) { log("error:", r.error); await new Promise((s) => setTimeout(s, 4000)); r = await get(`${base}/state?session=${np.session}&match=${matchId}`); continue; }
  if (!r.moveUrls?.length) { await new Promise((s) => setTimeout(s, 4000)); r = await get(r.next.state); continue; }
  // simple policy: attack with anything except the Warden/Captain when target unknown; else advance
  const beacon = Number((r.yourPieces.match(/(\d+)=Beacon/) ?? [])[1] ?? -99);
  const scored = r.legalMoves.map((m, i) => { const [ft, piece] = m.split(":"); const [f, t] = ft.replace("x", "").split("->").map(Number); let s = Math.random() * 3 + (t - f) / 8 * 2;
    if (f === beacon + 8 || f === beacon - 1 || f === beacon + 1) s -= 20; /* keep the Beacon guards in place (skill.md tip) */
    if (ft.endsWith("x")) s += ["Warden", "Captain"].includes(piece) ? -2 : 6; return { s, i }; }).sort((a, b) => b.s - a.s);
  const url = r.moveUrls[scored[0].i];
  const nr = await get(url); moves++;
  if (!staleChecked && nr.ok) { const dup = await get(url); log("refetch same move URL ->", dup.stale ? "stale:true (not moved twice)" : "MOVED AGAIN?!", "ply", dup.ply); staleChecked = true; }
  r = nr;
  log(`move ${moves}:`, r.ok ? (r.events ?? []).join(" | ") + ` [ply ${r.ply}, ${r.phase}]` : r.error);
}
console.log(r.board);
log("final:", r.status, "| txs:", r.txs?.join(" "));
log("watch:", watch);
const txt = await get(`${base}/state?session=${np.session}&match=${matchId}&format=text`);
console.log("--- format=text sample ---\n" + String(txt).slice(0, 600));
console.log(JSON.stringify({ matchId, moves, phase: r.phase, status: r.status, watch }));
