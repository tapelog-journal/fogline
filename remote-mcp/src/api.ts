// Plain HTTP JSON API mirroring the MCP tools, so any agent that can fetch a URL can play.
// Every action accepts GET (query params) and POST (JSON body). Always HTTP 200 with ok:true/false,
// because many agent fetch tools discard non-200 bodies. Base Sepolia testnet only.
import { DISCLAIMER, FUNDING, watchLink, type Env } from "./env";
import { checkChain, fmtPlay, RANK_IDX, RULES } from "./tools";
import { Phase } from "../../agent/src/rules";

const ACTIONS = ["rules", "new-player", "play-bot", "create", "join", "auto-army", "set-army", "move", "state", "resign", "wallet"] as const;
type Action = (typeof ACTIONS)[number];

// Link-preview and index crawlers must never trigger actions. User-initiated agent fetchers
// (ChatGPT-User, Claude-User, Perplexity-User, generic HTTP clients) are allowed.
const CRAWLER_UA = /(googlebot|bingbot|duckduckbot|yandex|baiduspider|slurp|applebot|facebookexternalhit|facebot|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|whatsapp|skypeuripreview|embedly|redditbot|pinterest|gptbot|oai-searchbot|claudebot|anthropic-ai|ccbot|bytespider|amazonbot|petalbot|semrush|ahrefs|mj12bot|dotbot|headlesschrome.*preview|preview)/i;
const READ_ONLY: Action[] = ["rules", "state", "wallet"];

const HEADERS = { "x-robots-tag": "noindex, nofollow, noarchive", "cache-control": "no-store, max-age=0", "access-control-allow-origin": "*" };

export async function handleApi(req: Request, env: Env, ip: string): Promise<Response> {
  const url = new URL(req.url), origin = url.origin;
  const action = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "") as Action;
  let p: Record<string, any> = Object.fromEntries(url.searchParams);
  if (req.method === "POST") {
    try { const b = await req.text(); if (b.trim()) p = { ...p, ...JSON.parse(b) }; } catch { return reply(p, { ok: false, error: "body must be JSON" }); }
  } else if (req.method !== "GET") return reply(p, { ok: false, error: "use GET or POST" });

  if (!action || (action as string) === "index") return reply(p, { ok: true, text: `Fogline HTTP API. Read ${origin}/skill.md for how to play. Actions: ${ACTIONS.join(", ")}.`, skill: `${origin}/skill.md` });
  if (!ACTIONS.includes(action)) return reply(p, { ok: false, error: `unknown action '${action}'. Actions: ${ACTIONS.join(", ")}. See ${origin}/skill.md` });
  if (!READ_ONLY.includes(action) && CRAWLER_UA.test(req.headers.get("user-agent") ?? "")) {
    return reply(p, { ok: false, error: "crawlers and link previews cannot take game actions" });
  }

  try {
    if (p.chainId !== undefined) checkChain(Number(p.chainId));
    if (action === "rules") return reply(p, { ok: true, text: RULES, skill: `${origin}/skill.md`, next: { newPlayer: `${origin}/api/new-player` } });

    if (action === "new-player") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const session = "fl_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      const r = await env.PLAYER.get(env.PLAYER.idFromName(session)).init(session, ip) as any;
      const next = { playBot: `${origin}/api/play-bot?session=${session}`, wallet: `${origin}/api/wallet?session=${session}` };
      return reply(p, {
        ok: true, session, address: r.address, funded: r.funding.ok, fundingTx: r.funding.url, fundingNote: r.funding.ok ? `${r.funding.amountEth} test ETH for gas + 1000 fUSD test tokens` : r.funding.reason,
        text: `New player. SESSION=${session} (keep it; pass it as ?session= on every call). ${r.funding.ok ? "Funded with test ETH and 1000 fUSD." : "NOT funded: " + r.funding.reason} Next: ${next.playBot}`,
        next,
      });
    }

    const session = String(p.session ?? "");
    if (!/^fl_[0-9a-f]{32}$/.test(session)) return reply(p, { ok: false, error: `missing or bad session. Get one from ${origin}/api/new-player` });
    const pl = env.PLAYER.get(env.PLAYER.idFromName(session)) as any;
    const stakeUnits = () => { const st = Number(p.stake ?? 0); if (!(st >= 0 && st <= 100)) throw new Error("stake must be 0..100 test fUSD"); return String(BigInt(Math.round(st * 1e6))); };
    const timeout = () => { if (p.timeout === undefined && p.turnTimeoutSeconds === undefined) return undefined; const t = Number(p.timeout ?? p.turnTimeoutSeconds); if (!(t >= 60 && t <= 3600)) throw new Error("timeout must be 60..3600 seconds"); return Math.floor(t); };
    const matchId = () => { const m = Number(p.match ?? p.matchId); if (!Number.isInteger(m) || m < 1) throw new Error("missing match (match id number)"); return String(m); };

    switch (action) {
      case "wallet": { const r = await pl.info(); return reply(p, { ok: true, ...r, text: `wallet ${r.address}: ${r.eth} test ETH, ${r.fUSD} fUSD; matches: ${r.matches.join(", ") || "none"}` }); }
      case "play-bot": {
        const r = await pl.playBot(stakeUnits(), timeout(), p.ref ? String(p.ref).slice(0, 64) : undefined);
        const next = { autoArmy: `${origin}/api/auto-army?session=${session}&match=${r.matchId}` };
        return reply(p, { ok: true, matchId: r.matchId, reused: !!r.reused, txs: r.txs.map((t: any) => t.url), watch: r.watch,
          text: `${r.reused ? "Reusing your match" : "Match"} #${r.matchId} vs the TapeLog house bot (${r.joined ? "bot joined" : "bot joining"}). Next place your army: ${next.autoArmy}  Watch: ${r.watch}`, next });
      }
      case "create": {
        const opp = p.opponent ? String(p.opponent) : undefined;
        if (opp && !/^0x[0-9a-fA-F]{40}$/.test(opp)) throw new Error("opponent must be a 0x address");
        const r = await pl.create(stakeUnits(), opp, timeout(), p.ref ? String(p.ref).slice(0, 64) : undefined);
        return reply(p, { ok: true, matchId: r.matchId, reused: !!r.reused, txs: r.txs.map((t: any) => t.url), watch: r.watch,
          text: `Match #${r.matchId} created and waiting for a friend. Your friend (their own session) opens: ${origin}/api/join?session=THEIR_SESSION&match=${r.matchId} . Then you both place armies: ${origin}/api/auto-army?session=${session}&match=${r.matchId}`,
          next: { autoArmy: `${origin}/api/auto-army?session=${session}&match=${r.matchId}`, state: `${origin}/api/state?session=${session}&match=${r.matchId}` } });
      }
      case "join": {
        const id = matchId(), r = await pl.join(id);
        return reply(p, { ok: true, matchId: id, already: !!r.already, txs: r.txs.map((t: any) => t.url), watch: r.watch,
          text: `${r.already ? "Already in" : "Joined"} match #${id}. Next: ${origin}/api/auto-army?session=${session}&match=${id}`, next: { autoArmy: `${origin}/api/auto-army?session=${session}&match=${id}` } });
      }
      case "auto-army": return play(p, origin, session, await pl.commitArmy(matchId()), "Army placed.");
      case "set-army": {
        const raw = Array.isArray(p.ranks) ? p.ranks : String(p.ranks ?? "").split(/[\s,]+/).filter(Boolean);
        const norm = raw.map((x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
        if (norm.length !== 16 || norm.some((x: string) => RANK_IDX[x] === undefined)) throw new Error("ranks must be 16 comma-separated rank names (Beacon, Ghost, Scout, Sapper, Guard, Knight, Captain, Warden, Mine) in starting-square order");
        return play(p, origin, session, await pl.commitArmy(matchId(), norm.map((x: string) => RANK_IDX[x])), "Custom army placed.");
      }
      case "move": {
        const from = Number(p.from), to = Number(p.to);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) throw new Error("from and to must be squares 0..63");
        if (p.ply === undefined && req.method === "GET") throw new Error("GET moves need &ply=<current ply> (copy the move URL from the last response) so a repeated fetch can't move twice");
        const ply = p.ply === undefined ? undefined : Number(p.ply);
        return play(p, origin, session, await pl.move(matchId(), from, to, ply), "");
      }
      case "state": return play(p, origin, session, await pl.state(matchId()), "");
      case "resign": {
        if (String(p.confirm ?? "") !== "yes") throw new Error("resigning ends the match: add &confirm=yes only if the human really wants to give up");
        return play(p, origin, session, await pl.resign(matchId()), "You resigned.");
      }
    }
  } catch (e: any) {
    return reply(p, { ok: false, error: String(e?.message ?? e).replace(/^Error:\s*/, "") });
  }
  return reply(p, { ok: false, error: "unhandled" });
}

function play(p: Record<string, any>, origin: string, session: string, r: any, prefix: string) {
  const base = `${origin}/api`, q = `session=${session}&match=${r.matchId}`;
  const moveUrls = (r.legalMoves ?? []).map((m: any) => `${base}/move?${q}&from=${m.from}&to=${m.to}&ply=${r.ply}`);
  const next: Record<string, string> = { state: `${base}/state?${q}` };
  if (r.phase === "Committing" && !r.yourPieces?.length) next.autoArmy = `${base}/auto-army?${q}`;
  if (r.phase === "Settled" || r.phase === "Ended") next.playAgain = `${base}/play-bot?session=${session}&ref=${Date.now().toString(36)}`;
  const body = {
    ok: true, matchId: r.matchId, phase: r.phase, ply: r.ply, yourTurn: r.yourTurn, yourSide: r.yourSide, status: r.status, stale: !!r.stale,
    events: r.events ?? [], board: r.board,
    legalMoves: (r.legalMoves ?? []).map((m: any) => `${m.from}->${m.to}${m.attack ? "x" : ""}${m.piece ? ":" + m.piece : ""}`),
    yourPieces: (r.yourPieces ?? []).map((x: any) => `${x.square}=${x.rank}`).join(" "),
    enemyPieces: (r.enemyPieces ?? []).map((x: any) => `${x.square}=${x.rank === "hidden" ? (x.moved ? "?moved" : "?") : x.rank}`).join(" "),
    txs: (r.txs ?? []).map((t: any) => t.url), watch: r.watch, moveUrls, next,
    text: (prefix ? prefix + " " : "") + [...(r.events ?? []), r.summary].filter(Boolean).join(". "),
  };
  return reply(p, body, () => {
    let t = (prefix ? prefix + "\n\n" : "") + fmtPlay(r);
    if (moveUrls.length) t += `\n\nMove links (open one to make that move; ply=${r.ply}):\n` + moveUrls.join("\n");
    t += `\n\nRefresh: ${next.state}` + (next.playAgain ? `\nPlay again: ${next.playAgain}` : "");
    return t;
  });
}

function reply(p: Record<string, any>, body: Record<string, any>, textFn?: () => string): Response {
  const full = { ...body, disclaimer: DISCLAIMER };
  if (String(p.format ?? "") === "text") {
    let t = textFn ? textFn() : body.ok === false ? `Error: ${body.error}` : [body.text, body.next ? "\nNext:\n" + Object.values(body.next).join("\n") : ""].join("\n");
    t = t.replace(/(https:\/\/[^\s]+\/api\/[a-z-]+\?[^\s]*)/g, (u) => (u.includes("format=") ? u : u + "&format=text"));
    return new Response(`${t}\n\n${DISCLAIMER}\n`, { headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(JSON.stringify(full, null, 1), { headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" } });
}

export const ROBOTS = `# Fogline API: game actions are for user-directed agents only, not crawlers.
User-agent: ChatGPT-User
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: *
Allow: /skill.md
Allow: /llms.txt
Disallow: /api/
`;

export { FUNDING, watchLink, Phase };
