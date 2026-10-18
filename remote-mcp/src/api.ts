// Plain HTTP JSON API mirroring the MCP tools, so any agent that can fetch a URL can play.
// Every action accepts GET (query params) and POST (JSON body). Always HTTP 200 with ok:true/false,
// because many agent fetch tools discard non-200 bodies. Base Sepolia testnet only.
import { DISCLAIMER, FUNDING, renderer, watchLink, type Env } from "./env";
import { ALIAS_LINKS, ALIAS_RE, ALIAS_WIDTH, aliasUrl, boardImageUrl, boardPageUrl } from "./boardimg";
import { checkChain, RANK_IDX, RULES } from "./tools";
import { mdPage } from "./md";
import { parseSquare } from "./view";
import { Phase } from "../../agent/src/rules";

const ACTIONS = ["rules", "new-player", "play-bot", "create", "join", "auto-army", "set-army", "move", "state", "resign", "wallet", "cosmetics", "buy-cosmetic", "link-board"] as const;
type Action = (typeof ACTIONS)[number];

// Link-preview and index crawlers must never trigger actions. User-initiated agent fetchers
// (ChatGPT-User, Claude-User, Perplexity-User, generic HTTP clients) are allowed.
const CRAWLER_UA = /(googlebot|bingbot|duckduckbot|yandex|baiduspider|slurp|applebot|facebookexternalhit|facebot|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|whatsapp|skypeuripreview|embedly|redditbot|pinterest|gptbot|oai-searchbot|claudebot|anthropic-ai|ccbot|bytespider|amazonbot|petalbot|semrush|ahrefs|mj12bot|dotbot|headlesschrome.*preview|preview)/i;
const READ_ONLY: Action[] = ["rules", "state", "wallet", "cosmetics"];

const HEADERS = { "x-robots-tag": "noindex, nofollow, noarchive", "cache-control": "no-store, max-age=0", "access-control-allow-origin": "*" };

export async function handleApi(req: Request, env: Env, ip: string, _ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(req.url), origin = url.origin;
  // render the board picture in the background so the image URL in the reply loads instantly
  // Render the board picture before replying so the image URL loads instantly. With a board-link name
  // (ChatGPT), bind the next pre-typed link /v/<name>/<n>.png to exactly this picture.
  const warm = async (r: any): Promise<string | undefined> => {
    if (!r?.scene) return undefined;
    const job = { scene: r.scene, players: r.players, block: r.block };
    if (r.boardAlias) {
      try {
        const pic = await renderer(env, r.matchId).png({ ...job, width: ALIAS_WIDTH });
        const session = String(p.session ?? "");
        const n = await (env.PLAYER.get(env.PLAYER.idFromName(session)) as any).recordAliasImage(r.matchId, pic.hash, ALIAS_LINKS);
        return aliasUrl(origin, r.boardAlias, n);
      } catch (e) { console.log("alias image failed", String(e).slice(0, 120)); }
    }
    try { await renderer(env, r.matchId).png(job); } catch (e) { console.log("prewarm failed", String(e).slice(0, 120)); }
    return undefined;
  };
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
      const board = p.board === undefined ? undefined : String(p.board).toLowerCase();
      if (board !== undefined && !ALIAS_RE.test(board)) return reply(p, { ok: false, error: "board must be 8-24 lowercase letters/digits (the name in the user's /v/NAME/1.png board links)" });
      const stub = env.PLAYER.get(env.PLAYER.idFromName(session)) as any;
      const r = await stub.init(session, ip) as any;
      if (board) { try { await stub.setBoardAlias(board); } catch (e: any) { r.aliasError = String(e?.message ?? e); } }
      const next = { playBot: `${origin}/api/play-bot?session=${session}`, wallet: `${origin}/api/wallet?session=${session}` };
      return reply(p, {
        ok: true, session, address: r.address, funded: r.funding.ok, fundingTx: r.funding.url, fundingNote: r.funding.ok ? `${r.funding.amountEth} test ETH for gas + 1000 fUSD test tokens` : r.funding.reason,
        boardLinks: board && !r.aliasError ? `linked: board pictures will use ${origin}/v/${board}/N.png` : r.aliasError,
        text: `New player. SESSION=${session} (keep it; pass it as ?session= on every call). ${r.funding.ok ? "Funded with test ETH and 1000 fUSD." : "NOT funded: " + r.funding.reason}${board && !r.aliasError ? ` Board links /v/${board}/N.png are linked to this player.` : ""} Next: ${next.playBot}`,
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
      case "link-board": {
        const board = String(p.board ?? "").toLowerCase();
        if (!ALIAS_RE.test(board)) throw new Error("board must be 8-24 lowercase letters/digits (the name in the user's /v/NAME/1.png board links)");
        await pl.setBoardAlias(board);
        return reply(p, { ok: true, text: `Board links ${origin}/v/${board}/1.png … /40.png now show this player's board. Each game response's board_image_markdown uses one of them.` });
      }
      case "cosmetics": {
        const r = await pl.cosmetics();
        const owned = new Set(r.owned);
        const lines = r.items.map((i: any) => `#${i.id} ${i.name} (${i.category}, ${i.rarity}, ${i.price} fUSD)${owned.has(i.id) ? " ✅ owned" : ""}${r.equipped.includes(i.id) ? " · equipped" : ""}`);
        return reply(p, { ok: true, owned: r.owned, equipped: r.equipped, fUSD: r.fUSD, items: lines,
          text: `Decorative cosmetics (zero gameplay effect), paid with valueless TEST fUSD on Base Sepolia. You have ${r.fUSD} fUSD and own ${r.owned.length}. Owned skins, tabletops, fog styles, trails, effects and banners appear in your board pictures. Buy one: ${origin}/api/buy-cosmetic?session=${session}&item=<id>`,
          catalog: "https://tapelog-journal.github.io/fogline/#cosmetics", next: { buy: `${origin}/api/buy-cosmetic?session=${session}&item=6` } }, () => `### Fogline cosmetics (test fUSD, decorative only)\n\nYou have **${r.fUSD} fUSD**. Owned items show up in your board picture.\n\n` + lines.map((l: string, k: number) => `- [${l}](${origin}/api/buy-cosmetic?session=${session}&item=${r.items[k].id})`).join("\n") + `\n\n_${DISCLAIMER}_`);
      }
      case "buy-cosmetic": {
        const item = String(p.item ?? p.id ?? "");
        if (!item) throw new Error("add &item=<id 1-22 or name>. List: " + `${origin}/api/cosmetics?session=${session}`);
        const r = await pl.buyCosmetic(item);
        return reply(p, { ok: true, item: r.item.name, alreadyOwned: r.alreadyOwned, equipped: r.equipped, txs: r.txs.map((t: any) => t.url),
          text: `${r.alreadyOwned ? "Already owned" : "Bought"} ${r.item.name} with test fUSD${r.equipped ? " and equipped it" : ""}. It now shows in your board pictures. Decorative only.`, next: { cosmetics: `${origin}/api/cosmetics?session=${session}` } });
      }
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
      case "auto-army": return play(warm, p, origin, session, await pl.commitArmy(matchId()), "Army placed.");
      case "set-army": {
        const raw = Array.isArray(p.ranks) ? p.ranks : String(p.ranks ?? "").split(/[\s,]+/).filter(Boolean);
        const norm = raw.map((x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
        if (norm.length !== 16 || norm.some((x: string) => RANK_IDX[x] === undefined)) throw new Error("ranks must be 16 comma-separated rank names (Beacon, Ghost, Scout, Sapper, Guard, Knight, Captain, Warden, Mine) in starting-square order");
        return play(warm, p, origin, session, await pl.commitArmy(matchId(), norm.map((x: string) => RANK_IDX[x])), "Custom army placed.");
      }
      case "move": {
        const from = parseSquare(p.from), to = parseSquare(p.to);
        if (Number.isNaN(from) || Number.isNaN(to)) throw new Error("from and to must be squares like b2 (a1..h8); numeric 0..63 also accepted");
        if (p.ply === undefined && req.method === "GET") throw new Error("GET moves need &ply=<current ply> (copy the move URL from the last response) so a repeated fetch can't move twice");
        const ply = p.ply === undefined ? undefined : Number(p.ply);
        return play(warm, p, origin, session, await pl.move(matchId(), from, to, ply), "");
      }
      case "state": return play(warm, p, origin, session, await pl.state(matchId()), "");
      case "resign": {
        if (String(p.confirm ?? "") !== "yes") throw new Error("resigning ends the match: add &confirm=yes only if the human really wants to give up");
        return play(warm, p, origin, session, await pl.resign(matchId()), "You resigned.");
      }
    }
  } catch (e: any) {
    return reply(p, { ok: false, error: String(e?.message ?? e).replace(/^Error:\s*/, "") });
  }
  return reply(p, { ok: false, error: "unhandled" });
}

async function play(warm: (r: any) => void | Promise<string | undefined>, p: Record<string, any>, origin: string, session: string, r: any, prefix: string) {
  const base = `${origin}/api`, q = `session=${session}&match=${r.matchId}`;
  const aliased = await warm(r);
  const img = aliased ?? boardImageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken);
  const page = boardPageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken);
  const fmt = p.format === "md" || p.format === "text" ? `&format=${p.format}` : "";
  const moveUrl = (f: string, t: string) => `${base}/move?${q}&from=${f}&to=${t}&ply=${r.ply}${fmt}`;
  const legal = r.legalMoves ?? [];
  const next: Record<string, string> = { state: `${base}/state?${q}${fmt}` };
  if (r.phase === "Committing" && !r.yourPieces?.length) next.autoArmy = `${base}/auto-army?${q}${fmt}`;
  if (r.phase === "Settled" || r.phase === "Ended") next.playAgain = `${base}/play-bot?session=${session}&ref=${Date.now().toString(36)}${fmt}`;
  const body = {
    ok: true, matchId: r.matchId, phase: r.phase, ply: r.ply, yourTurn: r.yourTurn, yourSide: r.yourSide, status: r.status, stale: !!r.stale,
    board_image_url: img,
    board_page_url: page,
    board_page_link: `[View board picture](${page})`,
    board_image_markdown: `![Fogline board, match #${r.matchId}, ply ${r.ply}](${img})`,
    board_image_user_typed: !!aliased,
    render_hint: aliased
      ? "Every turn: put board_image_markdown on its own line (not in a code block; it is one of the user's typed board links), then board_md as the table, then board_page_link as a prominent link."
      : "Every turn: show board_md as the table and board_page_link as a prominent clickable link (it opens the board picture). Add board_image_markdown on its own line only if your client displays web images from tool results (ChatGPT does not: it shows a broken image).",
    board_md: r.boardMd,
    lastTurn: (r.events?.length ? r.events : r.lastTurn) ?? [],
    legalMoves: legal.map((m: any) => `${m.piece ?? "piece"} ${m.fromSq} → ${m.toSq}${m.attack ? " ⚔️" : ""}`),
    movesByPiece: (r.movesByPiece ?? []).map((g: any) => `${g.piece} ${g.from} → ${g.to.join(", ")}`),
    moveUrls: legal.map((m: any) => moveUrl(m.fromSq, m.toSq)),
    yourPieces: (r.yourPieces ?? []).map((x: any) => `${x.sq} ${x.rank}`).join(", "),
    enemyPieces: (r.enemyPieces ?? []).map((x: any) => `${x.sq} ${x.rank === "hidden" ? (x.moved ? "hidden (has moved)" : "hidden") : x.rank}`).join(", "),
    txs: (r.txs ?? []).map((t: any) => t.url), watch: r.watch, next,
    text: (prefix ? prefix + " " : "") + [...((r.events?.length ? r.events : r.lastTurn) ?? []), r.summary].filter(Boolean).join(". "),
    board_ascii: r.board,
  };
  return reply(p, body, () => (prefix ? `**${prefix}**\n\n` : "") + mdPage({ ...r, txs: body.txs, boardImage: img, boardPage: page }, { move: moveUrl, refresh: next.state, extra: next.playAgain ? [["Play again", next.playAgain]] : next.autoArmy ? [["Place army", next.autoArmy]] : [] }));
}

function reply(p: Record<string, any>, body: Record<string, any>, textFn?: () => string): Response {
  const full = { ...body, disclaimer: DISCLAIMER };
  const f = String(p.format ?? "");
  if (f === "text" || f === "md") {
    let t = textFn ? textFn() : body.ok === false ? `**Error:** ${body.error}` : [body.text, body.next ? "\n" + Object.entries(body.next).map(([k, u]) => `- [${k}](${u})`).join("\n") : ""].join("\n") + `\n\n_${DISCLAIMER}_`;
    t = t.replace(/(https:\/\/[^\s)]+\/api\/[a-z-]+\?[^\s)]*)/g, (u) => (u.includes("format=") ? u : u + `&format=${f}`));
    return new Response(`${t}\n`, { headers: { ...HEADERS, "content-type": f === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8" } });
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
Allow: /img/
Allow: /v/
Disallow: /api/
`;

export { FUNDING, watchLink, Phase };
