// Plain HTTP JSON API mirroring the MCP tools, so any agent that can fetch a URL can play.
// Every action accepts GET (query params) and POST (JSON body). Always HTTP 200 with ok:true/false,
// because many agent fetch tools discard non-200 bodies. Base Sepolia testnet only.
import { DISCLAIMER, FUNDING, ladder, renderer, tourney, watchLink, type Env } from "./env";
import { publicView, scheduleView } from "./tourney";
import { ALIAS_LINKS, ALIAS_RE, ALIAS_WIDTH, aliasUrl, boardImageUrl, boardPageUrl } from "./boardimg";
import { checkChain, RANK_IDX, RULES } from "./tools";
import { mdPage } from "./md";
import { coord, parseSquare } from "./view";
import { RANK_NAMES } from "../../agent/src/rules";
import { Phase } from "../../agent/src/rules";
import { LEVEL_LABEL, parseLevel } from "../../agent/src/levels";

const ACTIONS = ["rules", "new-player", "play-bot", "create", "join", "auto-army", "set-army", "move", "state", "resign", "wallet", "cosmetics", "buy-cosmetic", "link-board", "ladder", "set-name", "equip-cosmetic", "tournament", "tournament-signup", "tournament-withdraw", "join-cup"] as const;
type Action = (typeof ACTIONS)[number];

// Link-preview and index crawlers must never trigger actions. User-initiated agent fetchers
// (ChatGPT-User, Claude-User, Perplexity-User, generic HTTP clients) are allowed.
const CRAWLER_UA = /(googlebot|bingbot|duckduckbot|yandex|baiduspider|slurp|applebot|facebookexternalhit|facebot|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|whatsapp|skypeuripreview|embedly|redditbot|pinterest|gptbot|oai-searchbot|claudebot|anthropic-ai|ccbot|bytespider|amazonbot|petalbot|semrush|ahrefs|mj12bot|dotbot|headlesschrome.*preview|preview)/i;
const READ_ONLY: Action[] = ["rules", "state", "wallet", "cosmetics", "ladder", "tournament"];

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
      const client = clientTag(p.client);
      const name = p.name === undefined ? undefined : checkName(p.name);
      const stub = env.PLAYER.get(env.PLAYER.idFromName(session)) as any;
      const r = await stub.init(session, ip) as any;
      if (board) { try { await stub.setBoardAlias(board); } catch (e: any) { r.aliasError = String(e?.message ?? e); } }
      try { await stub.setProfile(name, client); } catch (e) { console.log("profile failed", String(e).slice(0, 120)); }
      const next = { playBot: `${origin}/api/play-bot?session=${session}`, wallet: `${origin}/api/wallet?session=${session}` };
      return reply(p, {
        ok: true, session, address: r.address, funded: r.funding.ok, fundingTx: r.funding.url, fundingNote: r.funding.ok ? `${r.funding.amountEth} test ETH for gas + 1000 fUSD test tokens` : r.funding.reason,
        boardLinks: board && !r.aliasError ? `linked: board pictures will use ${origin}/v/${board}/N.png` : r.aliasError,
        text: `New player. SESSION=${session} (keep it; pass it as ?session= on every call). ${r.funding.ok ? "Funded with test ETH and 1000 fUSD." : "NOT funded: " + r.funding.reason}${board && !r.aliasError ? ` Board links /v/${board}/N.png are linked to this player.` : ""} Next: ${next.playBot}`,
        next,
      });
    }

    if (action === "ladder") return ladderReply(p, env, origin);
    if (action === "tournament") {
      let you: string | undefined;
      const sid = String(p.session ?? "");
      if (/^fl_[0-9a-f]{32}$/.test(sid)) { try { you = (await (env.PLAYER.get(env.PLAYER.idFromName(sid)) as any).profile()).address; } catch {} }
      return tournamentReply(p, env, origin, await (tourney(env) as any).overview(p.id ? String(p.id) : undefined), you);
    }

    const session = String(p.session ?? "");
    if (!/^fl_[0-9a-f]{32}$/.test(session)) return reply(p, { ok: false, error: `missing or bad session. Get one from ${origin}/api/new-player` });
    const pl = env.PLAYER.get(env.PLAYER.idFromName(session)) as any;
    const stakeUnits = () => { const st = Number(p.stake ?? 0); if (!(st >= 0 && st <= 100)) throw new Error("stake must be 0..100 test fUSD"); return String(BigInt(Math.round(st * 1e6))); };
    const timeout = () => { if (p.timeout === undefined && p.turnTimeoutSeconds === undefined) return undefined; const t = Number(p.timeout ?? p.turnTimeoutSeconds); if (!(t >= 60 && t <= 3600)) throw new Error("timeout must be 60..3600 seconds"); return Math.floor(t); };
    const matchId = () => { const m = Number(p.match ?? p.matchId); if (!Number.isInteger(m) || m < 1) throw new Error("missing match (match id number)"); return String(m); };

    switch (action) {
      case "set-name": {
        const name = checkName(p.name);
        const r = await pl.setProfile(name, p.client === undefined ? undefined : clientTag(p.client));
        return reply(p, { ok: true, name: r.name ?? null, client: r.client ?? "api", text: r.name ? `Your ladder name is now "${r.name}".` : "Ladder name cleared (you show as your short address).", next: { ladder: `${origin}/api/ladder` } });
      }
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
          text: `Decorative cosmetics (zero gameplay effect), paid with valueless TEST fUSD on Base Sepolia. You have ${r.fUSD} fUSD and own ${r.owned.length}. Owned skins, tabletops, fog styles, trails, effects and banners appear in your board pictures. Buy one: ${origin}/api/buy-cosmetic?session=${session}&item=<id> . Switch what's shown: ${origin}/api/equip-cosmetic?session=${session}&item=<owned id> . Live previews: https://tapelog-journal.github.io/fogline/shop.html`,
          catalog: "https://tapelog-journal.github.io/fogline/shop.html", preview: `${origin}/api/shop/preview.png?item=6`, next: { buy: `${origin}/api/buy-cosmetic?session=${session}&item=6` } }, () => `### Fogline cosmetics (test fUSD, decorative only)\n\nYou have **${r.fUSD} fUSD**. Owned items show up in your board picture.\n\n` + lines.map((l: string, k: number) => `- [${l}](${origin}/api/buy-cosmetic?session=${session}&item=${r.items[k].id})`).join("\n") + `\n\n_${DISCLAIMER}_`);
      }
      case "buy-cosmetic": {
        const item = String(p.item ?? p.id ?? "");
        if (!item) throw new Error("add &item=<id 1-22 or name>. List: " + `${origin}/api/cosmetics?session=${session}`);
        const r = await pl.buyCosmetic(item);
        return reply(p, { ok: true, item: r.item.name, alreadyOwned: r.alreadyOwned, equipped: r.equipped, txs: r.txs.map((t: any) => t.url),
          text: `${r.alreadyOwned ? "Already owned" : "Bought"} ${r.item.name} with test fUSD${r.equipped ? " and equipped it" : ""}. It now shows in your board pictures. Decorative only.`, next: { cosmetics: `${origin}/api/cosmetics?session=${session}` } });
      }
      case "join-cup":
      case "tournament-signup": {
        if (action === "join-cup" && !p.id) p.id = "next";
        if (p.name !== undefined) await pl.setProfile(checkName(p.name), p.client === undefined ? undefined : clientTag(p.client));
        else if (p.client !== undefined) await pl.setProfile(undefined, clientTag(p.client));
        const who = await pl.tourneyIdentity();
        const r = await (tourney(env) as any).signup(who, p.id ? String(p.id) : undefined);
        const v = publicView(r.tournament, env, who.address);
        return reply(p, { ok: true, already: r.already, tournament: v.name, id: v.id, startsAt: v.startsAt, signupClosesAt: v.signupClosesAt, signedUp: v.signedUp,
          text: `${r.already ? "You were already signed up for" : "Signed up for"} ${v.name}. It starts ${v.startsAt} (UTC; sign-ups close 5 minutes before); ${v.signedUp} player(s) so far, TapeLog bots fill the bracket. Single elimination, ${v.turnTimeoutSeconds} s per turn, rounds capped at ${v.roundCapMinutes} min. When your match is created it shows up in ${origin}/api/tournament?session=${session} (and on the Play page); place your army and move as usual. Prizes are a cosmetic banner and test fUSD only.`,
          next: { tournament: `${origin}/api/tournament?session=${session}`, page: "https://tapelog-journal.github.io/fogline/tournament.html" } });
      }
      case "tournament-withdraw": {
        const who = await pl.tourneyIdentity();
        const r = await (tourney(env) as any).withdraw(who.address, p.id ? String(p.id) : undefined);
        return reply(p, { ok: true, removed: r.removed, text: r.removed ? "You withdrew from the tournament." : "You were not signed up." });
      }
      case "equip-cosmetic": {
        const item = String(p.item ?? p.id ?? "");
        if (!item) throw new Error("add &item=<owned item id 1-22>, or &item=none&slot=pieces|board to go back to the default look");
        const slot = p.slot === undefined ? undefined : /^(0|pieces?|skin)$/i.test(String(p.slot)) ? 0 : /^(1|board|table)$/i.test(String(p.slot)) ? 1 : -1;
        const r = await pl.equipCosmetic(item, slot);
        const slotName = r.slot === 0 ? "pieces" : "board";
        return reply(p, { ok: true, item: r.item?.name ?? null, slot: slotName, already: r.already, txs: r.txs.map((t: any) => t.url),
          text: r.item ? `${r.already ? "Already equipped" : "Equipped"} ${r.item.name} (${slotName} slot). Board pictures use it from now on. Decorative only.` : `Cleared the ${slotName} slot (best owned items are used, or the default look).`, next: { cosmetics: `${origin}/api/cosmetics?session=${session}` } });
      }
      case "wallet": { const r = await pl.info(); return reply(p, { ok: true, ...r, text: `wallet ${r.address}: ${r.eth} test ETH, ${r.fUSD} fUSD; matches: ${r.matches.join(", ") || "none"}` }); }
      case "play-bot": {
        const level = parseLevel(p.level ?? p.difficulty);
        const r = await pl.playBot(stakeUnits(), timeout(), p.ref ? String(p.ref).slice(0, 64) : undefined, level);
        const next = { autoArmy: `${origin}/api/auto-army?session=${session}&match=${r.matchId}` };
        return reply(p, { ok: true, matchId: r.matchId, level: r.level, reused: !!r.reused, txs: r.txs.map((t: any) => t.url), watch: r.watch,
          text: `${r.reused ? "Reusing your match" : "Match"} #${r.matchId} vs the TapeLog house bot, ${LEVEL_LABEL[r.level as keyof typeof LEVEL_LABEL] ?? r.level} level (${r.joined ? "bot joined" : "bot joining"}). Next place your army: ${next.autoArmy}  Watch: ${r.watch}`, next });
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
  if (r.phase === "Settled" || r.phase === "Ended") next.playAgain = `${base}/play-bot?session=${session}${r.botLevel ? `&level=${r.botLevel}` : ""}&ref=${Date.now().toString(36)}${fmt}`;
  // highlight clips: a share URL after a capture, and the winning moment at the end
  const evs: string[] = (r.events?.length ? r.events : r.lastTurn) ?? [];
  const ended = r.phase === "Settled" || r.phase === "Ended";
  const capture = evs.some((e: string) => /attacker wins|both removed/.test(e));
  if (ended || capture) next.clip = `${origin}/clip/${r.matchId}/${ended && r.winner !== undefined && Number(r.winner) < 2 ? "win" : "last"}`;
  const body = {
    ok: true, matchId: r.matchId, ...(r.botLevel ? { botLevel: r.botLevel } : {}), phase: r.phase, ply: r.ply, yourTurn: r.yourTurn, yourSide: r.yourSide, status: r.status, stale: !!r.stale,
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
    ...(next.clip ? { highlight_clip: { share_url: next.clip, gif_url: `${next.clip}.gif`, all: `${origin}/api/match/${r.matchId}/highlights`, hint: "Share page with an animated GIF; posting the share URL on X shows a preview card." } } : {}),
    text: (prefix ? prefix + " " : "") + [...((r.events?.length ? r.events : r.lastTurn) ?? []), r.summary].filter(Boolean).join(". "),
    board_ascii: r.board,
    // structured, fog-of-war-filtered view for UIs (the Play page): own ranks, revealed enemy ranks, hidden = null
    view: r.scene ? {
      side: r.scene.viewSide, turn: r.turn, winner: r.winner, reason: r.reason, deadline: r.deadline,
      cells: r.scene.cells.map((c: any) => ({ sq: coord(c.sq), side: c.side, rank: c.rank === null ? null : RANK_NAMES[c.rank] })),
      lost: r.scene.captured.map((l: any[]) => l.map((c) => (c.rank === null ? null : RANK_NAMES[c.rank]))),
      last: r.last ? { from: coord(r.last.from), to: coord(r.last.to) } : null,
      startSquares: r.scene.viewSide >= 0 ? Array.from({ length: 16 }, (_, i) => coord(r.scene.viewSide === 0 ? i : 48 + i)) : [],
    } : undefined,
    moves: legal.map((m: any) => ({ from: m.fromSq, to: m.toSq, piece: m.piece ?? null, attack: !!m.attack })),
  };
  return reply(p, body, () => (prefix ? `**${prefix}**\n\n` : "") + mdPage({ ...r, txs: body.txs, boardImage: img, boardPage: page }, { move: moveUrl, refresh: next.state, extra: [...(next.playAgain ? [["Play again", next.playAgain]] : next.autoArmy ? [["Place army", next.autoArmy]] : []), ...(next.clip ? [["🎬 Highlight clip", next.clip]] : [])] as [string, string][] }));
}

const CLIENT_LABEL: Record<string, string> = { browser: "browser (human)", mcp: "MCP", skill: "skill.md agent", api: "API", house: "TapeLog bot", unknown: "unknown" };
async function ladderReply(p: Record<string, any>, env: Env, origin: string) {
  const limit = Math.max(1, Math.min(100, Number(p.limit ?? 50) || 50));
  const t = await ladder(env).top(limit);
  const short = (a: string) => (a.startsWith("0x") ? a.slice(0, 6) + "…" + a.slice(-4) : "TapeLog bot");
  const rows = t.players.map((e: any, i: number) => ({ rank: i + 1, name: e.name ?? null, player: short(e.address), address: e.address, client: e.client, clientLabel: CLIENT_LABEL[e.client] ?? e.client, rating: e.rating, peak: e.peak ?? e.rating, games: e.games, wins: e.w, losses: e.l, draws: e.d, lastPlayed: e.last ? new Date(e.last).toISOString() : null }));
  return reply(p, { ok: true, ladder: rows, totalRated: t.total, matchesScanned: t.scanned, recent: t.recent, page: "https://tapelog-journal.github.io/fogline/ladder.html",
    text: `Fogline ladder (Elo, start ${1200}): ${rows.slice(0, 10).map((r: any) => `${r.rank}. ${r.name ?? r.player} ${r.rating} (${r.wins}-${r.losses}-${r.draws}, ${r.clientLabel})`).join("; ") || "no rated matches yet"}. Ratings change only for matches that settled onchain. Set your name: ${origin}/api/set-name?session=SESSION&name=HANDLE` },
    () => `### Fogline ladder\n\nElo ratings from matches that settled onchain (testnet). Client kind is self-reported.\n\n| # | Player | Rating | W-L-D | Client |\n|-:|---|-:|:-:|---|\n` + rows.map((r: any) => `| ${r.rank} | ${(r.name ?? r.player).replace(/\|/g, "/")} | ${r.rating} | ${r.wins}-${r.losses}-${r.draws} | ${r.clientLabel} |`).join("\n") + `\n\n[Ladder page](https://tapelog-journal.github.io/fogline/ladder.html)\n\n_${DISCLAIMER}_`);
}

function tournamentReply(p: Record<string, any>, env: Env, origin: string, o: any, you?: string) {
  const v = publicView(o.tournament, env, you);
  const when = new Date(v.startsAtMs).toUTCString().replace(":00 GMT", " UTC");
  const yourLine = v.you ? (v.you.match ? ` Your current match: #${v.you.match.matchId ?? "(being created)"} ${v.you.match.a} vs ${v.you.match.b} (${v.you.match.status}).` : v.you.signedUp ? (v.status === "signup" ? " You are signed up." : v.you.eliminated ? " You are out." : "") : " You are not signed up.") : "";
  const nx = o.next ? publicView(o.next, env, you) : undefined;
  const lead = nx && nx.id !== v.id ? `Next: ${nx.name} at ${new Date(nx.startsAtMs).toUTCString().replace(":00 GMT", " UTC")} (${nx.signedUp}/${nx.maxPlayers}; join in one call: ${origin}/api/join-cup?session=SESSION). ` : "";
  const text = lead + (v.status === "signup" ? `${v.name}: sign-ups open, starts ${when}. ${v.signedUp}/${v.maxPlayers} signed up. Single elimination vs agents, humans and TapeLog bots; prizes: ${v.prizes.map((x: any) => `#${x.place} ${x.cosmetic ? x.cosmetic + " + " : ""}${x.testFusd} test fUSD`).join(", ")}. Sign up: ${origin}/api/join-cup?session=SESSION${yourLine}`
    : v.status === "running" ? `${v.name} is running: ${v.rounds.map((r: any) => `${r.name}: ${r.matches.map((m: any) => `${m.a ?? "bye"} vs ${m.b ?? "bye"}${m.winner ? ` → ${m.winner}` : m.matchId ? ` (#${m.matchId})` : ""}`).join("; ")}`).join(" | ")}.${yourLine}`
    : v.status === "done" ? `${v.name} finished. Champion: ${v.champion}; runner-up: ${v.runnerUp}.${yourLine}` : `${v.name}: ${v.status}${v.note ? ` (${v.note})` : ""}.`) + (v.finalClip ? ` Final clip: ${v.finalClip}` : "");
  const sv = scheduleView(o, env, you);
  return reply(p, { ok: true, ...sv, tournament: v, list: o.list, page: "https://tapelog-journal.github.io/fogline/tournament.html", text }, () => `### ${v.name}\n\n${text}\n\n` + v.rounds.map((r: any) => `**${r.name}**\n` + r.matches.map((m: any) => `- ${m.a ?? "bye"} vs ${m.b ?? "bye"}: ${m.winner ? `**${m.winner}** advances` : m.matchId ? `[match #${m.matchId}](${m.watch})` : m.status}${m.note ? ` (${m.note})` : ""}`).join("\n")).join("\n\n") + `\n\n[Bracket page](https://tapelog-journal.github.io/fogline/tournament.html)\n\n_Prizes are valueless test tokens and decorative cosmetics only. ${DISCLAIMER}_`);
}

/** Client kind as reported by the client itself (no tracking): browser Play page, MCP, skill.md agent, or plain API. */
export function clientTag(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return s === "browser" || s === "mcp" || s === "skill" ? s : "api";
}
/** Optional public handle: 2-24 letters, digits, spaces, _ . - (empty string clears it). */
export function checkName(v: unknown): string {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (s === "") return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,23}$/.test(s)) throw new Error("name must be 2-24 characters: letters, digits, spaces, _ . -");
  return s;
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
