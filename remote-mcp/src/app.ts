// ChatGPT app (OpenAI Apps SDK, MCP Apps standard): the in-chat Fogline board widget.
// Widget source: ../../chatgpt-app/widget.html, served as an MCP resource. Board tools link to it through
// _meta.ui.resourceUri (standard) and _meta["openai/outputTemplate"] (ChatGPT alias) and return
// structuredContent the widget renders. The board picture rides in result _meta (hidden from the model).
// Fog of war: everything here comes from the player's own fog-filtered view; hidden enemy ranks are never sent.
// Game for entertainment. Base Sepolia testnet only. Not investment advice.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// @ts-ignore text module (wrangler rule)
import WIDGET from "../../chatgpt-app/widget.html";

export const WIDGET_URI = "ui://fogline/board-v1.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";
export const widgetHtml = () => WIDGET as string;

/** Tool-descriptor _meta for tools that render the board widget (and that the widget may call). */
export function boardToolMeta(invoking: string, invoked: string) {
  return {
    ui: { resourceUri: WIDGET_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}
/** Tools the widget calls but that do not render it themselves. */
export const appCallableMeta = { ui: { visibility: ["model", "app"] }, "openai/widgetAccessible": true };

export function registerWidget(server: McpServer, origin: string) {
  server.registerResource("fogline-board", WIDGET_URI, {
    title: "Fogline board",
    description: "Interactive Fogline board: your army with equipped cosmetics, fog of war, tap a piece then a square to move.",
    mimeType: WIDGET_MIME,
  }, async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: WIDGET_MIME,
      text: widgetHtml(),
      _meta: {
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [origin] } },
        "openai/widgetDescription": "Shows the user's Fogline board and lets them move by tapping. The board already shows the state, so do not repeat the board as text; summarize what happened in one or two sentences.",
        "openai/widgetPrefersBorder": false,
        "openai/widgetCSP": { connect_domains: [], resource_domains: [origin] },
      },
    }],
  }));
}

/** Compact, model-safe structured board data (player's own fog-filtered view). */
export function boardStructured(r: any, img: string, page: string) {
  const committing = r.phase === "Committing";
  return {
    matchId: String(r.matchId), ply: Number(r.ply), phase: String(r.phase), yourSide: r.yourSide, yourTurn: !!r.yourTurn,
    status: r.status, summary: r.summary,
    canPlaceArmy: committing && (!(r.yourPieces?.length) || /place your army/i.test(r.status ?? "")),
    lastTurn: r.lastTurn ?? [], events: r.events ?? [],
    legalMoves: (r.legalMoves ?? []).map((m: any) => ({ from: m.from, to: m.to, fromSq: m.fromSq, toSq: m.toSq, piece: m.piece, attack: !!m.attack })),
    yourPieces: (r.yourPieces ?? []).map((p: any) => ({ square: p.square, sq: p.sq, rank: p.rank })),
    enemyPieces: (r.enemyPieces ?? []).map((p: any) => ({ square: p.square, sq: p.sq, rank: p.rank, moved: !!p.moved })),
    board_md: r.boardMd, board_image_url: img, board_page_url: page, watch: r.watch,
    disclaimer: "Game for entertainment. Testnet only. Not investment advice.",
  };
}
