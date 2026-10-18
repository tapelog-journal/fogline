// Board picture endpoint: GET /api/match/<id>/board.png
//   ?view=<token>  a player's own view (token from that player's responses; shows only their own ranks)
//   no view        spectator view (nothing hidden is revealed)
//   &t=<ply>       cache buster only
import { Phase } from "../../agent/src/rules";
import { readState } from "./chain";
import { cfg, DEFAULT_LOOK_PAIR, renderer, type Env } from "./env";
import { sceneFrom } from "./render";

const enc = new TextEncoder();
async function hmac(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode("fogline-view-v1:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  return [...sig.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Read-only view capability for one player in one match: "<player object id>.<mac>". Reveals nothing but that player's own board view. */
export async function viewToken(env: Env, playerObjectId: string, matchId: string) {
  return `${playerObjectId}.${await hmac(env.IP_SALT, `${playerObjectId}:${matchId}`)}`;
}
export async function checkViewToken(env: Env, token: string, matchId: string): Promise<string | undefined> {
  const m = token.match(/^([0-9a-f]{64})\.([0-9a-f]{24})$/);
  if (!m) return undefined;
  const want = await hmac(env.IP_SALT, `${m[1]}:${matchId}`);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? m[1] : undefined;
}

export function boardImageUrl(origin: string, matchId: string, ply: number | string, phase: string | number, token?: string) {
  return `${origin}/api/match/${matchId}/board.png?${token ? `view=${token}&` : ""}t=${ply}-${String(phase).slice(0, 3).toLowerCase()}`;
}

const PNG_HEADERS = { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "public, max-age=15", "x-content-type-options": "nosniff" };

export async function handleBoardImage(req: Request, env: Env, matchId: string): Promise<Response> {
  const url = new URL(req.url);
  if (!/^\d{1,9}$/.test(matchId)) return new Response("bad match id", { status: 400 });
  const view = url.searchParams.get("view");
  try {
    let r: { png: Uint8Array; hash: string; cached: boolean };
    if (view) {
      const objectId = await checkViewToken(env, view, matchId);
      if (!objectId) return new Response("invalid view token", { status: 403 });
      const p: any = env.PLAYER.get(env.PLAYER.idFromString(objectId));
      r = await p.boardPng(matchId);
    } else {
      const c = cfg(env), s = await readState(c.rpcUrl, c.game, BigInt(matchId));
      if (s.match.phase === Phase.None) return new Response("no such match", { status: 404 });
      const scene = sceneFrom(s, -1, undefined, DEFAULT_LOOK_PAIR());
      r = await renderer(env, matchId).png({ scene, players: [s.match.players[0], s.match.players[1]], block: s.block.toString() });
    }
    return new Response(r.png, { headers: { ...PNG_HEADERS, etag: `"${r.hash}"`, "x-fogline-cache": r.cached ? "hit" : "miss" } });
  } catch (e: any) {
    return new Response(`render failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500, headers: { "content-type": "text/plain" } });
  }
}
