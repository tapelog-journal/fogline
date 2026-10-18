// GET-only test: new player, buy decorative cosmetics with test fUSD, play a few turns vs the house bot,
// and save the player-view and spectator board pictures. Usage: node test/image-e2e.mjs [outDir] [turns]
// FOGLINE_RESOLVE_IP pins *.workers.dev to an IP (for networks that intercept workers.dev).
import { Agent, fetch as ufetch } from "undici";
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.env.FOGLINE_BASE ?? "https://fogline-mcp.tapelog.workers.dev";
const out = process.argv[2] ?? "/tmp/fogline-e2e"; const turns = Number(process.argv[3] ?? 6);
mkdirSync(out, { recursive: true });
const pin = process.env.FOGLINE_RESOLVE_IP;
const dispatcher = pin ? new Agent({ connect: { lookup: (h, o, cb) => (h.endsWith("workers.dev") ? cb(null, [{ address: pin, family: 4 }]) : cb(null, [{ address: "0.0.0.0", family: 4 }])) } }) : undefined;
const raw = (u) => ufetch(u, { dispatcher, headers: { "user-agent": "fogline-image-e2e/1.0" } });
const get = async (u) => { const t = await (await raw(u)).text(); try { return JSON.parse(t); } catch { return t; } };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const save = async (u, name) => { const r = await raw(u); const b = Buffer.from(await r.arrayBuffer()); writeFileSync(`${out}/${name}`, b); log("saved", name, r.status, r.headers.get("content-type"), `${(b.length / 1024).toFixed(0)}KB`, r.headers.get("x-fogline-cache")); return b; };

// FOGLINE_SESSION + FOGLINE_MATCH continue an existing match instead of creating a new funded player
let S = process.env.FOGLINE_SESSION, M = process.env.FOGLINE_MATCH, r;
if (!S) {
  const np = await get(`${BASE}/api/new-player`); if (!np.ok) throw new Error(np.error);
  S = np.session; log("player", np.address, np.funded);
  for (const item of (process.env.ITEMS ?? "6,9,13,17,20,21").split(",")) { const b = await get(`${BASE}/api/buy-cosmetic?session=${S}&item=${item}`); log("buy", item, b.ok ? b.text : b.error); }
}
const cos = await get(`${BASE}/api/cosmetics?session=${S}`); log("owned", cos.owned, "equipped", cos.equipped);
if (!M) { r = await get(`${BASE}/api/play-bot?session=${S}`); M = r.matchId; log("match", M, r.text); r = await get(r.next.autoArmy); log("army", r.phase, r.board_image_url ? "has image url" : "NO IMAGE URL"); }
else r = await get(`${BASE}/api/state?session=${S}&match=${M}`);
for (let i = 0; i < 20 && !r.moveUrls?.length && r.phase !== "Settled"; i++) { await new Promise((s) => setTimeout(s, 4000)); r = await get(`${BASE}/api/state?session=${S}&match=${M}`); }
let n = 0;
while (n < turns && r.phase !== "Settled") {
  if (!r.ok || !r.moveUrls?.length) { await new Promise((s) => setTimeout(s, 4000)); r = await get(`${BASE}/api/state?session=${S}&match=${M}`); continue; }
  // prefer attacks with non-key pieces, else advance a Scout/Guard/Knight forward
  const scored = r.legalMoves.map((m, i) => { let s = Math.random(); if (m.includes("⚔️") && !/Warden|Captain/.test(m)) s += 5; if (/^(Scout|Guard|Knight|Sapper)/.test(m)) s += 1; const [f, t] = m.match(/[a-h][1-8]/g); if (t[1] > f[1]) s += 1.5; return { i, s }; }).sort((a, b) => b.s - a.s);
  const mv = r.legalMoves[scored[0].i]; r = await get(r.moveUrls[scored[0].i]); n++;
  log(`move ${n}: ${mv} →`, r.ok ? (r.lastTurn ?? []).join(" | ") : r.error);
}
log("final ply", r.ply, r.phase);
writeFileSync(`${out}/state.json`, JSON.stringify({ session: "(redacted)", matchId: M, ply: r.ply, board_image_url: r.board_image_url?.replace(/view=[^&]+/, "view=…"), board_image_markdown: !!r.board_image_markdown, render_hint: r.render_hint }, null, 1));
await save(r.board_image_url, "player.png");
await save(r.board_image_url, "player-again.png");
await save(`${BASE}/api/match/${M}/board.png?t=${r.ply}`, "spectator.png");
const bad = await raw(`${BASE}/api/match/${M}/board.png?view=${"0".repeat(64)}.${"0".repeat(24)}`); log("forged token ->", bad.status);
const md = await get(`${BASE}/api/state?session=${S}&match=${M}&format=md`);
writeFileSync(`${out}/state.md`, md.replace(/fl_[0-9a-f]{32}/g, "SESSION").replace(/view=[0-9a-f.]+/g, "view=TOKEN")); log("md first lines:\n" + md.split("\n").slice(0, 4).join("\n").replace(/view=[0-9a-f.]+/g, "view=TOKEN"));
// MCP: fogline_state returns an image block
const mcp = await (await ufetch(`${BASE}/mcp`, { dispatcher, method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fogline_state", arguments: { session: S, matchId: Number(M) } } }) })).json();
const types = mcp.result?.content?.map((c) => c.type); log("MCP content types:", types, "image bytes:", mcp.result?.content?.find((c) => c.type === "image")?.data?.length);
console.log(JSON.stringify({ matchId: M, ply: r.ply }));
