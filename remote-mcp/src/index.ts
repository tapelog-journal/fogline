import { watchLink } from "./env";
// Fogline remote MCP server on Cloudflare Workers.
//   POST/GET/DELETE /mcp   Streamable HTTP (stateless, JSON responses)
//   GET /sse + POST /messages?sessionId=...   legacy SSE transport
// Base Sepolia testnet only. Game for entertainment. Testnet only. Not investment advice.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer, houseAddress, VERSION } from "./tools";
import { cfg, DISCLAIMER, FUNDING, MAX_HOUSE_MATCHES, type Env } from "./env";
import { handleApi, ROBOTS } from "./api";
import { chatgptPrompt, handleAliasImage, handleBoardImage, handleBoardPage } from "./boardimg";
// @ts-ignore text module (wrangler rule)
import SKILL from "../skill.md";
// @ts-ignore text module (wrangler rule)
import LLMS from "../llms.txt";

export { Player } from "./player";
export { House } from "./house";
export { Funder } from "./funder";
export { SseSession } from "./sse";
export { Renderer } from "./renderer";
export { Ladder } from "./ladder";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};
const withCors = (r: Response) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); };

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    cfg(env); // hard-refuse misconfigured chain ids at the edge
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";

    const pic = url.pathname.match(/^\/api\/match\/(\d{1,9})\/board\.png$/);
    if (pic) return handleBoardImage(req, env, pic[1]);
    const img = url.pathname.match(/^\/img\/(\d{1,9})\/[0-9a-z-]{1,16}\/([0-9a-f]{64}\.[0-9a-f]{24}|spectator)\.png$/);
    if (img) return handleBoardImage(req, env, img[1], img[2] === "spectator" ? "" : img[2]);
    const bp = url.pathname.match(/^\/board\/(\d{1,9})\/([0-9]{1,5}-[a-z]{1,3})\/([0-9a-f]{64}\.[0-9a-f]{24}|spectator)$/);
    if (bp) return handleBoardPage(req, bp[1], bp[2], bp[3], watchLink(env, bp[1]));
    const al = url.pathname.match(/^\/v\/([a-z0-9]{8,24})\/(\d{1,3})\.png$/);
    if (al) return handleAliasImage(req, env, al[1], Number(al[2]));
    const hist = url.pathname.match(/^\/api\/match\/(\d{1,9})\/history$/);
    if (hist) {
      const H = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3" };
      try { return new Response(JSON.stringify(await env.RENDER.get(env.RENDER.idFromName("history")).history(hist[1])), { headers: H }); }
      catch (e: any) { return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 200) }), { status: 200, headers: H }); }
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(req, env, ip, ctx);
    if (url.pathname === "/skill.md" || url.pathname === "/SKILL.md") return new Response(SKILL as string, { headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
    if (url.pathname === "/llms.txt") return new Response(LLMS as string, { headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
    if (url.pathname === "/chatgpt" || url.pathname === "/chatgpt.txt") return new Response(chatgptPrompt(url.origin, url.searchParams.get("name") ?? undefined), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
    if (url.pathname === "/robots.txt") return new Response(ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8" } });

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      if (req.method !== "POST") {
        // stateless server: no standalone SSE stream / session to delete
        return withCors(new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp (or use /sse for the legacy SSE transport)." }, id: null }), { status: 405, headers: { "content-type": "application/json", allow: "POST, OPTIONS" } }));
      }
      const server = buildServer(env, ip, url.origin);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const res = await transport.handleRequest(req);
      ctx.waitUntil(Promise.resolve().then(() => server.close()).catch(() => {}));
      return withCors(res);
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/") {
      if (req.method !== "GET") return new Response("GET only", { status: 405 });
      const sid = crypto.randomUUID().replace(/-/g, "");
      const u = new URL(req.url); u.searchParams.set("sessionId", sid);
      return env.SSE.get(env.SSE.idFromName(sid)).fetch(new Request(u.toString(), req));
    }
    if (url.pathname === "/messages" || url.pathname === "/sse/message") {
      const sid = url.searchParams.get("sessionId");
      if (!sid || !/^[0-9a-f]{32}$/.test(sid)) return new Response("missing sessionId", { status: 400 });
      return env.SSE.get(env.SSE.idFromName(sid)).fetch(req);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      const c = cfg(env);
      const stats = url.searchParams.has("stats") ? await env.FUNDER.get(env.FUNDER.idFromName("funder")).stats() : undefined;
      return withCors(Response.json({
        name: "Fogline remote MCP by TapeLog", version: VERSION, skill: `${url.origin}/skill.md`, api: `${url.origin}/api`, mcp: `${url.origin}/mcp`, sse: `${url.origin}/sse`, chainId: c.chainId, game: c.game, token: c.token,
        house: houseAddress(env), maxHouseMatches: MAX_HOUSE_MATCHES,
        funding: { perPlayerEth: Number(FUNDING.grantWei) / 1e18, maxPerIpPerDay: FUNDING.maxGrantsPerIpPerDay, maxPerDay: FUNDING.maxGrantsPerDay },
        repo: "https://github.com/tapelog-journal/fogline", disclaimer: DISCLAIMER, ...(stats ? { stats } : {}),
      }));
    }
    return new Response("not found", { status: 404 });
  },
};
