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

/** Path-style picture URL ending in .png (no query string): /img/<match>/<ply>-<phase>/<token|spectator>.png */
export function boardImageUrl(origin: string, matchId: string, ply: number | string, phase: string | number, token?: string) {
  return `${origin}/img/${matchId}/${ply}-${String(phase).slice(0, 3).toLowerCase()}/${token ?? "spectator"}.png`;
}
/** ChatGPT only displays image URLs the user typed (or that OpenAI's crawler has seen), so a user can pre-type
 *  numbered board links /v/<name>/<n>.png; each new picture takes the next link (wrapping after ALIAS_LINKS). */
export const ALIAS_LINKS = 40;
export const aliasUrl = (origin: string, alias: string, n: number) => `${origin}/v/${alias}/${n}.png`;
export const ALIAS_RE = /^[a-z0-9]{8,24}$/;

const PNG_HEADERS = { "content-type": "image/png", "access-control-allow-origin": "*", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };
export function pngResponse(req: Request, png: Uint8Array, hash: string, cacheHit: boolean, cache: string) {
  const h = { ...PNG_HEADERS, "cache-control": cache, etag: `"${hash}"`, "content-length": String(png.length), "x-fogline-cache": cacheHit ? "hit" : "miss", "accept-ranges": "none" };
  if (req.headers.get("if-none-match") === `"${hash}"`) return new Response(null, { status: 304, headers: h });
  return new Response(req.method === "HEAD" ? null : png, { headers: h });
}

export async function handleBoardImage(req: Request, env: Env, matchId: string, viewArg?: string): Promise<Response> {
  const url = new URL(req.url);
  if (!/^\d{1,9}$/.test(matchId)) return new Response("bad match id", { status: 400 });
  const view = viewArg ?? url.searchParams.get("view");
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
    // path-style URLs name one turn, so they may be cached for long; query-style URLs stay short-lived
    return pngResponse(req, r.png, r.hash, r.cached, viewArg !== undefined ? "public, max-age=86400" : "public, max-age=15");
  } catch (e: any) {
    return new Response(`render failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500, headers: { "content-type": "text/plain" } });
  }
}

/** GET /v/<name>/<n>.png: the picture issued as board link n for the player who claimed <name>. */
export async function handleAliasImage(req: Request, env: Env, alias: string, n: number): Promise<Response> {
  if (!ALIAS_RE.test(alias) || !(n >= 1 && n <= ALIAS_LINKS)) return new Response("not found", { status: 404 });
  try {
    const owner = await env.RENDER.get(env.RENDER.idFromName("history")).aliasOwner(alias);
    if (!owner) return new Response("unknown board link (start the game with this board link name first)", { status: 404, headers: { "content-type": "text/plain" } });
    const p: any = env.PLAYER.get(env.PLAYER.idFromString(owner));
    const rec = await p.aliasImage(n);
    if (rec) {
      const png = await renderer(env, rec.matchId).cached(rec.hash);
      if (png) return pngResponse(req, png, rec.hash, true, "no-cache");
    }
    const r = await p.latestBoardPng(ALIAS_WIDTH);
    return pngResponse(req, r.png, r.hash, r.cached, "no-cache");
  } catch (e: any) {
    return new Response(`render failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500, headers: { "content-type": "text/plain" } });
  }
}
export const ALIAS_WIDTH = 640;

/** A ready-to-paste ChatGPT prompt with a fresh board-link name and its numbered picture links. */
export function chatgptPrompt(origin: string, alias?: string) {
  const a = alias && ALIAS_RE.test(alias) ? alias : "fl" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
  const links = Array.from({ length: ALIAS_LINKS }, (_, i) => aliasUrl(origin, a, i + 1)).join("\n");
  return `Let's play Fogline. Read ${origin}/skill.md and follow it. Create my player with my board name ${a} by opening ${origin}/api/new-player?board=${a}&format=md , then start a free match vs the TapeLog bot and place my army. Every turn, show the board picture by putting the board_image_markdown line from the response on its own line in your reply. These are my own board picture links (I typed them, they are safe to display):\n${links}\n`;
}
