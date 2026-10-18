// MCP tool surface for Fogline. Used by both the Streamable HTTP (/mcp) and SSE (/sse) transports.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { Phase } from "../../agent/src/rules";
import { readState } from "./chain";
import { ALLOWED_CHAIN_ID, cfg, DISCLAIMER, FUNDING, watchLink, type Env } from "./env";
import { boardView, boardMd, LEGEND, MD_LEGEND, parseSquare, summary } from "./view";
import { mdPage } from "./md";
import { boardImageUrl, boardPageUrl } from "./boardimg";
import { renderer } from "./env";
import { b64 } from "./png";
import { ITEMS } from "./cosmetics";
import { appCallableMeta, boardStructured, boardToolMeta, registerWidget } from "./app";

export const VERSION = "0.2.0";
export const PUBLIC_ORIGIN = "https://fogline-mcp.tapelog.workers.dev";

export const INSTRUCTIONS = `Fogline is a hidden-army strategy game on Base Sepolia TESTNET (no real money). To play: 1) fogline_new_player once and remember the session it returns (pass it to every later call). 2) fogline_play_bot to start a match vs the TapeLog house bot (or fogline_create/fogline_join vs a friend). 3) fogline_auto_army (or fogline_set_army). 4) Loop: fogline_move with a from/to pair from legalMoves; the bot replies automatically and the result includes the new board as a picture (an image block plus a board_image_url: show it to the user each turn as a markdown image, falling back to the text board only if images can't be shown). Use fogline_state to look again. In ChatGPT these board tools also show an interactive board widget (the user can tap a piece, then a square, to move; widget moves are reported back to you), so when the widget is shown keep your reply short and do not redraw the board. Optional: fogline_cosmetics / fogline_buy_cosmetic for decorative skins and tabletops (test fUSD). Share the watch link. ${DISCLAIMER}`;

export const RULES = `FOGLINE RULES (an original TapeLog game)
Board: 8x8. Squares are named like chess: files a-h (left to right) and ranks 1-8 (rank 1 is side A's home edge), e.g. c2. Squares c4 and f5 are fog banks: nobody can enter or pass them.
Armies: each side has 16 pieces placed secretly on its two home ranks (side A: a1-h2, side B: a7-h8). Only a hash of each piece is onchain until it is revealed (commit-reveal), so your opponent cannot see your ranks.
Pieces (rank number, count): Beacon (0, x1, cannot move; if it is captured you lose), Ghost (1, x1, weakest but defeats the Warden when the Ghost attacks), Scout (2, x3, moves 1-3 squares in a straight line; moving 2+ squares reveals it), Sapper (3, x2, defuses Mines), Guard (4, x3), Knight (5, x2), Captain (6, x1), Warden (7, x1, strongest), Mine (8, x2, cannot move; destroys any attacker except a Sapper and is used up).
Moves: one piece per turn, one square up/down/left/right (Scouts up to 3 in a line, no jumping). Moving onto an enemy piece is an attack: both pieces are revealed and the higher rank wins; on a tie the defender holds. Beacon: any attacker captures it and wins. Mine: attacker and Mine are both removed, except a Sapper which removes the Mine and survives.
Win: capture the enemy Beacon. You also win if the opponent resigns or lets their turn timer run out. After a win the winner's whole army is checked onchain (handled automatically here). 400 plies = draw.
Strategy tips: keep the Beacon on your back row behind Mines; probe unknown pieces with cheap Scouts and Guards; unmoved enemy pieces may be Mines or the Beacon, so send Sappers at them; save the Ghost for the enemy Warden.
In this server your wallet, secret army salts and reveals are handled for you. Stakes are optional and use fUSD, a valueless test token. Real-money wagering is disabled.
${DISCLAIMER}`;

const sessionArg = z.string().regex(/^fl_[0-9a-f]{32}$/).describe("Your player session id from fogline_new_player (looks like fl_ followed by 32 hex characters).");
const matchArg = z.number().int().min(1).describe("Match id number.");
const chainArg = z.number().int().optional().describe(`Optional. Only ${ALLOWED_CHAIN_ID} (Base Sepolia testnet) is accepted; anything else is refused.`);
const stakeArg = z.number().min(0).max(100).default(0).describe("Optional stake in fUSD, a valueless TESTNET token (0-100, default 0 = free). Winner takes both stakes.");
const timeoutArg = z.number().int().min(60).max(3600).optional().describe("Seconds each side has per turn before the other side can claim a win (60-3600, default 600).");
const RANK = z.enum(["Beacon", "Ghost", "Scout", "Sapper", "Guard", "Knight", "Captain", "Warden", "Mine"]);
export const RANK_IDX: Record<string, number> = { Beacon: 0, Ghost: 1, Scout: 2, Sapper: 3, Guard: 4, Knight: 5, Captain: 6, Warden: 7, Mine: 8 };

function text(t: string, isError = false) {
  return { content: [{ type: "text" as const, text: `${t}\n\n${DISCLAIMER}` }], ...(isError ? { isError: true } : {}) };
}
export function checkChain(chainId?: number) {
  if (chainId !== undefined && chainId !== ALLOWED_CHAIN_ID) throw new Error(`chainId ${chainId} refused: Fogline remote MCP only works on Base Sepolia testnet (${ALLOWED_CHAIN_ID}).`);
}
function err(e: any) {
  const m = String(e?.message ?? e).replace(/^Error:\s*/, "");
  return text(`Error: ${m}`, true);
}
export function fmtPlay(r: any, origin = PUBLIC_ORIGIN) {
  const img = boardImageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken);
  const page = boardPageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken);
  return "Every turn show the user the text board (exactly as given) and the clickable [View board picture](board_page_url) link. Also copy the markdown image line (![Fogline board](...)) on its own line if your client displays web images.\n\n" + `board_image_url: ${img}\nboard_page_url: ${page}\n\n` + mdPage({ ...r, boardImage: img, boardPage: page });
}
/** Tool result for a board: markdown text (with image link) + the PNG itself as an MCP image block. */
async function boardResult(env: Env, r: any, prefix: string, origin: string) {
  const content: any[] = [{ type: "text" as const, text: `${prefix}${fmtPlay(r, origin)}\n\n${DISCLAIMER}` }];
  const img = boardImageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken), page = boardPageUrl(origin, r.matchId, r.ply, r.phase, r.viewToken);
  const _meta: Record<string, unknown> = {};
  try {
    if (r.scene) {
      const pic = await renderer(env, r.matchId).png({ scene: r.scene, players: r.players, block: r.block });
      const data = b64(pic.png);
      content.push({ type: "image" as const, data, mimeType: "image/png" });
      _meta["fogline/boardPng"] = `data:image/png;base64,${data}`; // for the ChatGPT board widget (hidden from the model)
    }
  } catch (e) { console.log("inline board image failed", String(e).slice(0, 160)); }
  return { content, structuredContent: boardStructured(r, img, page), _meta };
}

const DOCS: Record<string, { title: string; text: () => string; url: string }> = {
  rules: { title: "Fogline rules", text: () => RULES, url: "https://github.com/tapelog-journal/fogline#rules" },
  "how-to-play": { title: "How to play Fogline from an AI assistant", text: () => INSTRUCTIONS, url: "https://github.com/tapelog-journal/fogline#play-from-chatgpt--claude" },
};

export function buildServer(env: Env, ip: string, origin = PUBLIC_ORIGIN) {
  const c = cfg(env);
  const server = new McpServer({ name: "fogline", title: "Fogline by TapeLog", version: VERSION }, { instructions: INSTRUCTIONS });
  const player = (session: string): any => env.PLAYER.get(env.PLAYER.idFromName(session));
  const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const WR = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  registerWidget(server, origin);

  server.registerTool("fogline_rules", {
    title: "Fogline rules", description: "Use this first if the user wants to play Fogline or asks how it works: returns the full rules, piece set, square numbering and strategy tips.",
    inputSchema: {}, annotations: RO,
  }, async () => text(RULES));

  server.registerTool("fogline_new_player", {
    title: "Create a Fogline player",
    description: `Use this once before playing. Creates a throwaway Base Sepolia TESTNET wallet managed by the server, funds it with a little test ETH for gas (${Number(FUNDING.grantWei) / 1e18} ETH) and 1000 fUSD test tokens, and returns a session id. Remember the session id and pass it to every other Fogline tool. Do not create a new player for every match; reuse the session.`,
    inputSchema: { chainId: chainArg, board: z.string().regex(/^[a-z0-9]{8,24}$/).optional().describe("Optional board-link name from the user's pre-typed /v/NAME/N.png links (lets ChatGPT display board pictures).") }, annotations: WR,
  }, async ({ chainId, board }) => {
    try {
      checkChain(chainId);
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const session = "fl_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      const r = await player(session).init(session, ip);
      if (board) { try { await player(session).setBoardAlias(board); } catch (e: any) { r.aliasError = String(e?.message ?? e); } }
      try { await player(session).setProfile(undefined, "mcp"); } catch {}
      return text(`New Fogline player created.\nsession: ${session}  (pass this to every Fogline tool)\nwallet: ${r.address} (Base Sepolia testnet, managed by the server)\n` +
        (r.funding.ok ? `funded with ${r.funding.amountEth} test ETH: ${r.funding.url}\n` : `NOT funded: ${r.funding.reason}. You can still watch and read state, but cannot send moves until funded.\n`) +
        (r.faucet ? `1000 fUSD test tokens: ${r.faucet.url}\n` : "") + `\nNext: fogline_play_bot to play the TapeLog house bot.`);
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_wallet", {
    title: "Fogline player wallet", description: "Use this to see the player's testnet wallet address, test ETH and fUSD balances, and recent match ids.",
    inputSchema: { session: sessionArg }, annotations: RO,
  }, async ({ session }) => {
    try { const r = await player(session).info(); return text(`wallet ${r.address}\ntest ETH: ${r.eth}\nfUSD (test): ${r.fUSD}\nmatches: ${r.matches.join(", ") || "none"}`); } catch (e) { return err(e); }
  });

  server.registerTool("fogline_play_bot", {
    title: "Play the TapeLog bot",
    description: "Use this when the user wants to play against the computer. Creates a match against the TapeLog house bot, which joins and plays automatically. You are side A and move first after both armies are placed. Next call fogline_auto_army (or fogline_set_army).",
    inputSchema: { session: sessionArg, stake: stakeArg, turnTimeoutSeconds: timeoutArg, chainId: chainArg }, annotations: WR, _meta: appCallableMeta,
  }, async ({ session, stake, turnTimeoutSeconds, chainId }) => {
    try {
      checkChain(chainId);
      const r = await player(session).playBot(String(BigInt(Math.round((stake ?? 0) * 1e6))), turnTimeoutSeconds);
      return { ...text(`Match #${r.matchId} created vs the TapeLog house bot${stake ? ` (stake ${stake} test fUSD)` : ""}. ${r.joined ? "The bot has joined." : "The bot is joining now."}\nNext: fogline_auto_army with matchId ${r.matchId}.\n\nOnchain transactions:\n${r.txs.map((t: any) => `- ${t.fn}: ${t.url}`).join("\n")}\n\nWatch live: ${r.watch}`), structuredContent: { matchId: String(r.matchId), joined: !!r.joined, watch: r.watch } };
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_create", {
    title: "Create a match vs a friend",
    description: "Use this when the user wants to play another person or agent. Creates an open match (or one reserved for `opponent`). Share the match id; the friend joins with fogline_join from their own session.",
    inputSchema: { session: sessionArg, stake: stakeArg, opponent: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Optional wallet address that is the only one allowed to join."), turnTimeoutSeconds: timeoutArg, chainId: chainArg },
    annotations: WR,
  }, async ({ session, stake, opponent, turnTimeoutSeconds, chainId }) => {
    try {
      checkChain(chainId);
      const r = await player(session).create(String(BigInt(Math.round((stake ?? 0) * 1e6))), opponent, turnTimeoutSeconds);
      return text(`Match #${r.matchId} created and waiting for an opponent. Tell your friend to call fogline_join with matchId ${r.matchId}.\n\nOnchain transactions:\n${r.txs.map((t: any) => `- ${t.fn}: ${t.url}`).join("\n")}\n\nWatch live: ${r.watch}`);
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_join", {
    title: "Join a friend's match", description: "Use this to join an open match by id (approves the test-token stake automatically if there is one). Then call fogline_auto_army.",
    inputSchema: { session: sessionArg, matchId: matchArg, chainId: chainArg }, annotations: WR,
  }, async ({ session, matchId, chainId }) => {
    try {
      checkChain(chainId);
      const r = await player(session).join(String(matchId));
      return text(`Joined match #${matchId}. Next: fogline_auto_army.\n\nOnchain transactions:\n${r.txs.map((t: any) => `- ${t.fn}: ${t.url}`).join("\n")}\n\nWatch live: ${r.watch}`);
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_auto_army", {
    title: "Auto-place army", description: "Use this right after a match starts to place a sensible random secret army (Beacon on the back row guarded by Mines). Waits briefly for the opponent and returns the board.",
    inputSchema: { session: sessionArg, matchId: matchArg }, annotations: WR, _meta: boardToolMeta("Placing your secret army…", "Army placed"),
  }, async ({ session, matchId }) => {
    try { return await boardResult(env, await player(session).commitArmy(String(matchId)), "Army placed (hidden onchain as hashes).\n\n", origin); } catch (e) { return err(e); }
  });

  server.registerTool("fogline_set_army", {
    title: "Place a custom army",
    description: "Use this instead of fogline_auto_army when the user wants to choose the layout. Give exactly 16 rank names in order of your starting squares (side A: a1..h1 then a2..h2; side B: a7..h7 then a8..h8). Must contain exactly: 1 Beacon, 1 Ghost, 3 Scout, 2 Sapper, 3 Guard, 2 Knight, 1 Captain, 1 Warden, 2 Mine.",
    inputSchema: { session: sessionArg, matchId: matchArg, ranks: z.array(RANK).length(16).describe("16 rank names in starting-square order.") }, annotations: WR, _meta: boardToolMeta("Placing your army…", "Army placed"),
  }, async ({ session, matchId, ranks }) => {
    try { return await boardResult(env, await player(session).commitArmy(String(matchId), ranks.map((r) => RANK_IDX[r])), "Custom army placed (hidden onchain as hashes).\n\n", origin); } catch (e) { return err(e); }
  });

  server.registerTool("fogline_move", {
    title: "Make a move",
    description: "Use this on your turn. Moves your piece from square `from` to square `to`, written like b2 and b3 (pick from the listed moves). Moving onto an enemy piece attacks it. Reveals are handled automatically. When playing the house bot, this waits for the bot's reply and returns what happened plus the new board and your next legal moves.",
    inputSchema: { session: sessionArg, matchId: matchArg, from: z.union([z.string(), z.number()]).describe("Square of your piece, e.g. \"b2\" (numeric 0-63 also accepted)."), to: z.union([z.string(), z.number()]).describe("Destination square, e.g. \"b3\".") },
    annotations: WR, _meta: boardToolMeta("Moving… waiting for the reply", "Board updated"),
  }, async ({ session, matchId, from, to }) => {
    try {
      const f = parseSquare(from), t = parseSquare(to);
      if (Number.isNaN(f) || Number.isNaN(t)) throw new Error("from/to must be squares like \"b2\" (a1..h8)");
      return await boardResult(env, await player(session).move(String(matchId), f, t), "", origin);
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_state", {
    title: "Show the board",
    description: "Use this to see a match from the player's point of view: your pieces with ranks, enemy pieces as hidden unless revealed, whose turn it is, the turn timer, your legal moves and a watch link. Read-only.",
    inputSchema: { session: sessionArg, matchId: matchArg }, annotations: RO, _meta: boardToolMeta("Loading the board…", "Board ready"),
  }, async ({ session, matchId }) => {
    try { return await boardResult(env, await player(session).state(String(matchId)), "", origin); } catch (e) { return err(e); }
  });

  server.registerTool("fogline_resign", {
    title: "Resign", description: "Use this only when the user explicitly wants to give up the match. The opponent wins (and any test-token stake).",
    inputSchema: { session: sessionArg, matchId: matchArg }, annotations: { ...WR, destructiveHint: true }, _meta: boardToolMeta("Resigning…", "Resigned"),
  }, async ({ session, matchId }) => {
    try { return await boardResult(env, await player(session).resign(String(matchId)), "You resigned.\n\n", origin); } catch (e) { return err(e); }
  });

  server.registerTool("fogline_cosmetics", {
    title: "List Fogline cosmetics",
    description: "Use this when the user asks about skins, tabletops, effects or how to customize their board picture. Lists the 22 decorative items (zero gameplay effect), their test-fUSD prices, and which ones this player owns. Owned items are drawn in the player's board pictures.",
    inputSchema: { session: sessionArg }, annotations: RO,
  }, async ({ session }) => {
    try {
      const r = await player(session).cosmetics(), owned = new Set(r.owned);
      return text(`Fogline cosmetics: decorative only, paid with valueless TEST fUSD (you have ${r.fUSD}).\n` + ITEMS.map((i) => `#${i.id} ${i.name} · ${i.category} · ${i.rarity} · ${i.price} fUSD${owned.has(i.id) ? " · OWNED" : ""}${r.equipped.includes(i.id) ? " (equipped)" : ""}`).join("\n") + "\n\nBuy with fogline_buy_cosmetic. Gallery: https://tapelog-journal.github.io/fogline/#cosmetics");
    } catch (e) { return err(e); }
  });

  server.registerTool("fogline_buy_cosmetic", {
    title: "Buy a Fogline cosmetic (test fUSD)",
    description: "Use this when the user wants a decorative item for their board picture. Buys one item with valueless TEST fUSD on Base Sepolia (skipped if already owned) and equips skins/tabletops. No real money; no gameplay effect.",
    inputSchema: { session: sessionArg, item: z.union([z.number().int().min(1).max(22), z.string()]).describe("Item id 1-22 or exact name from fogline_cosmetics.") },
    annotations: WR,
  }, async ({ session, item }) => {
    try {
      const r = await player(session).buyCosmetic(String(item));
      return text(`${r.alreadyOwned ? "Already owned" : "Bought"} ${r.item.name}${r.equipped ? " and equipped it" : ""}. It now appears in your board pictures.${r.txs.length ? "\n\nOnchain transactions:\n" + r.txs.map((t: any) => `- ${t.fn}: ${t.url}`).join("\n") : ""}`);
    } catch (e) { return err(e); }
  });

  // ---- search / fetch (read-only compatibility tools for ChatGPT deep research / company knowledge)
  server.registerTool("search", {
    title: "Search Fogline docs and matches",
    description: "Search Fogline rules and how-to-play docs, or look up a public match by number (e.g. 'match 12'). Returns ids for the fetch tool.",
    inputSchema: { query: z.string().describe("Search query") }, annotations: RO,
  }, async ({ query }) => {
    const q = query.toLowerCase(), results: { id: string; title: string; url: string }[] = [];
    const m = q.match(/(?:match|game)?\s*#?\s*(\d{1,7})/);
    if (m) results.push({ id: `match:${m[1]}`, title: `Fogline match #${m[1]} (public view)`, url: watchLink(env, m[1]) });
    for (const [id, d] of Object.entries(DOCS)) results.push({ id, title: d.title, url: d.url });
    const payload = { results };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], structuredContent: payload };
  });

  server.registerTool("fetch", {
    title: "Fetch a Fogline doc or match",
    description: "Fetch the full text for an id returned by search: 'rules', 'how-to-play', or 'match:<id>' (public spectator view: hidden pieces stay hidden).",
    inputSchema: { id: z.string().describe("Id from search") }, annotations: RO,
  }, async ({ id }) => {
    let doc: { id: string; title: string; text: string; url: string; metadata?: Record<string, string> };
    if (DOCS[id]) doc = { id, title: DOCS[id].title, text: DOCS[id].text(), url: DOCS[id].url };
    else if (/^match:\d+$/.test(id)) {
      const mid = BigInt(id.slice(6)), s = await readState(c.rpcUrl, c.game, mid);
      if (s.match.phase === Phase.None) doc = { id, title: `Match #${mid}`, text: "No such match.", url: watchLink(env, mid) };
      else { const sm = summary(s, -1); doc = { id, title: `Fogline match #${mid}`, text: `${sm.line}\n\n${boardMd(s, -1)}\n\n${MD_LEGEND}`, url: watchLink(env, mid), metadata: { chainId: String(ALLOWED_CHAIN_ID), game: c.game } }; }
    } else doc = { id, title: "Not found", text: "Unknown id. Try 'rules', 'how-to-play' or 'match:<number>'.", url: "https://github.com/tapelog-journal/fogline" };
    return { content: [{ type: "text" as const, text: JSON.stringify(doc) }], structuredContent: doc };
  });

  return server;
}

export function houseAddress(env: Env) { return privateKeyToAccount(env.HOUSE_KEY as Hex).address; }
