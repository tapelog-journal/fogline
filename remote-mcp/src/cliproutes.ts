// Routes for highlight clips. /clip/<match>/<step|win|last>          share page (OG / X card tags)
//                              /clip/<match>/<step>.gif               the animated clip
//                              /clip/<match>/<step>/card.png          1200x630 share card
//                              /api/match/<match>/highlights          JSON list
import { renderer, watchLink, type Env } from "./env";
import { sharePage } from "./clips";

const H = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

export async function handleClip(req: Request, env: Env, _ctx: ExecutionContext, matchId: string, which: string, suffix: string): Promise<Response> {
  const origin = new URL(req.url).origin;
  try {
    const r: any = await renderer(env, matchId).clip(matchId, which);
    if (!r) return new Response("no such highlight (yet): captures and wins get clips", { status: 404, headers: { ...H, "content-type": "text/plain" } });
    const step = String(r.meta.step);
    if (which !== step) return Response.redirect(`${origin}/clip/${matchId}/${step}${suffix}`, 302); // stable URLs for sharing
    const etag = `"clip-${matchId}-${step}-v1${suffix}"`;
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...H, etag } });
    if (suffix === ".gif") return new Response(r.gif, { headers: { ...H, "content-type": "image/gif", "cache-control": "public, max-age=86400", etag } });
    if (suffix === "/card.png") return new Response(r.card, { headers: { ...H, "content-type": "image/png", "cache-control": "public, max-age=86400", etag } });
    return new Response(sharePage(origin, { matchId, step: r.meta.step, title: r.meta.title, detail: r.meta.detail, names: r.meta.names, watch: watchLink(env, matchId) }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
  } catch (e: any) {
    return new Response(`clip failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500, headers: { ...H, "content-type": "text/plain" } });
  }
}

export async function handleHighlights(req: Request, env: Env, matchId: string): Promise<Response> {
  const origin = new URL(req.url).origin;
  const J = { ...H, "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=10" };
  try {
    const r: any = await renderer(env, matchId).highlights(matchId);
    const items = r.items.map((x: any) => ({ ...x, share: `${origin}/clip/${matchId}/${x.step}`, gif: `${origin}/clip/${matchId}/${x.step}.gif`, card: `${origin}/clip/${matchId}/${x.step}/card.png` }));
    return new Response(JSON.stringify({ ok: true, matchId, done: r.done, highlights: items, watch: watchLink(env, matchId) }), { headers: J });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 200) }), { headers: J });
  }
}
