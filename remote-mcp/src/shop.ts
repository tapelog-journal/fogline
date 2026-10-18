// Cosmetics shop previews: GET /api/shop/preview.png?item=ID[&match=N]
// Draws a real, live match (spectator view: fog of war intact, nothing hidden is revealed) with one cosmetic
// applied to both armies, using the same renderer as the board pictures players get. For effects, trails and
// banners (which only show on a capture, a move or a win) the picture stages a sample moment on that board.
// Decorative only, zero gameplay effect. Test fUSD only. Game for entertainment. Testnet only.
import { Phase } from "../../agent/src/rules";
import { readState } from "./chain";
import { findItem, ITEMS } from "./cosmetics";
import { cfg, ladder, renderer, type Env } from "./env";
import { pngResponse } from "./boardimg";
import { DEFAULT_LOOK, sceneFrom, type LastAction, type Look } from "./render";

const BLOCKED = new Set([26, 37]);
let live: { at: number; id: string } | undefined;

/** The most recent match with something on the board (prefers one in progress). Cached for a minute. */
export async function liveMatch(env: Env): Promise<string> {
  if (live && Date.now() - live.at < 60_000) return live.id;
  const c = cfg(env), lad = ladder(env) as any;
  const latest = Number((await lad.latest()) ?? 1);
  let fallback = "";
  for (let id = latest; id >= Math.max(1, latest - 10); id--) {
    const s = await readState(c.rpcUrl, c.game, BigInt(id));
    if (s.match.ply < 2) continue;
    if (s.match.phase === Phase.Playing || s.match.phase === Phase.PendingReveal) { live = { at: Date.now(), id: String(id) }; return live.id; }
    if (!fallback) fallback = String(id);
  }
  live = { at: Date.now(), id: fallback || String(latest) };
  return live.id;
}

export function lookWith(itemId: number): Look {
  const look: Look = { ...DEFAULT_LOOK, fx: [] };
  const it = ITEMS.find((i) => i.id === itemId);
  if (!it) return look;
  if (it.category === "effect") look.fx = [it.id];
  else (look as any)[it.category === "table" ? "table" : it.category] = it.id;
  return look;
}

export async function handleShopPreview(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("item") ?? "0";
  const it = q === "0" || q === "none" ? undefined : findItem(q);
  if (q !== "0" && q !== "none" && !it) return new Response("unknown item (1-22)", { status: 404 });
  try {
    const m = url.searchParams.get("match");
    const matchId = m && /^\d{1,9}$/.test(m) ? m : await liveMatch(env);
    const c = cfg(env), s = await readState(c.rpcUrl, c.game, BigInt(matchId));
    if (s.match.phase === Phase.None) return new Response("no such match", { status: 404 });
    const look = lookWith(it?.id ?? 0);
    const scene = sceneFrom(s, -1, undefined, [look, { ...look, fx: [...look.fx] }]);
    // a finished match would show its result banner over every preview: show the position as in play instead
    if (scene.phase >= Phase.Ended) { scene.phase = Phase.Playing; scene.winner = 0; scene.reason = 0; }
    // stage a sample moment for things that only show on a move, a capture or a win
    if (it && (it.category === "effect" || it.category === "trail")) {
      const pick = stagedMove(scene.cells, it.category === "trail");
      if (pick) {
        const last: LastAction = { from: pick.from, to: pick.to, side: 0, attack: it.category === "effect", attackerRank: 5 };
        if (it.id !== 14) last.outcome = 0; // 14 Reveal Flip & Glow shows on a reveal
        if (it.id === 15) last.defenderRank = 8; else if (it.id === 16) last.defenderRank = 0; else if (it.category === "effect") last.defenderRank = 4;
        scene.last = last;
        if (it.id === 16) { scene.phase = Phase.Settled; scene.winner = 0; scene.reason = 1; }
      }
    }
    if (it?.category === "banner") { scene.phase = Phase.Settled; scene.winner = 0; scene.reason = 1; }
    const r = await renderer(env, matchId).png({ scene, players: [s.match.players[0], s.match.players[1]], block: s.block.toString(), fixedLooks: true, width: Number(url.searchParams.get("w")) === 400 ? 400 : undefined });
    const res = pngResponse(req, r.png, r.hash, r.cached, "public, max-age=30");
    res.headers.set("x-fogline-preview-match", matchId);
    res.headers.set("access-control-expose-headers", "x-fogline-preview-match");
    return res;
  } catch (e: any) {
    return new Response(`preview failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500, headers: { "content-type": "text/plain" } });
  }
}

/** A side-A piece and an empty square next to it (a 2-3 square line for trails), for staging a sample move. */
function stagedMove(cells: { sq: number; side: number }[], long: boolean) {
  const occ = new Set(cells.map((c) => c.sq));
  const mine = cells.filter((c) => c.side === 0).sort((a, b) => b.sq - a.sq); // most advanced first
  for (const c of mine) {
    for (const d of [-8, -1, 1]) {
      const path: number[] = [];
      let sq = c.sq;
      for (let k = 0; k < (long ? 3 : 1); k++) {
        const n = sq + d;
        if (n < 0 || n >= 64 || (Math.abs(d) === 1 && Math.floor(n / 8) !== Math.floor(sq / 8)) || occ.has(n) || BLOCKED.has(n)) break;
        path.push(n); sq = n;
      }
      if (path.length >= (long ? 2 : 1)) return { from: path[path.length - 1], to: c.sq };
    }
  }
  return undefined;
}
