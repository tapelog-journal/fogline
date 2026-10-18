// Markdown rendering of a player's view, shared by the HTTP API (?format=md, board_md) and MCP tool output.
import { MD_LEGEND } from "./view";
import { DISCLAIMER } from "./env";

export interface MdLinks { move?: (from: string, to: string) => string; refresh?: string; extra?: [string, string][] }

export function mdPage(r: any, links: MdLinks = {}): string {
  const out: string[] = [];
  const turn = r.yourTurn ? "**Your turn**" : r.status;
  out.push(`### Fogline match #${r.matchId} · ply ${r.ply} · ${turn}`);
  if (r.boardImage) out.push(`![Fogline board, match #${r.matchId}, ply ${r.ply}](${r.boardImage})`);
  out.push(`You are 🔵 (${r.yourSide === "B" ? "side B, board shown from your side" : "side A, bottom ranks 1-2, moving up"}). ${r.yourTurn ? "" : r.status ?? ""}`.trim());
  const happened = (r.events?.length ? r.events : r.lastTurn) ?? [];
  if (happened.length) out.push(`**Last turn:** ${happened.join(" · ")}`);
  if (r.boardMd) out.push((r.boardImage ? "**Text board** (fallback only if the picture above does not show):\n\n" : "") + r.boardMd + "\n\n" + MD_LEGEND);
  if (r.movesByPiece?.length) {
    const list = r.movesByPiece.map((g: any) => {
      const tos = g.to.map((t: string) => { const sq = t.replace("⚔️", ""); return links.move ? `[${t}](${links.move(g.from, sq)})` : t; });
      return `- **${g.piece ?? "piece"} ${g.from}** → ${tos.join(" · ")}`;
    });
    out.push(`**Your moves** (${links.move ? "click a square to move there" : "call fogline_move with from/to like \"b2\" and \"b3\""}; ⚔️ = attack):\n` + list.join("\n"));
  }
  const foot: string[] = [];
  if (links.refresh) foot.push(`[Refresh board](${links.refresh})`);
  for (const [label, url] of links.extra ?? []) foot.push(`[${label}](${url})`);
  if (r.watch) foot.push(`[Watch live](${r.watch})`);
  if (foot.length) out.push(foot.join(" · "));
  if (r.txs?.length) out.push("Transactions: " + r.txs.map((t: any, i: number) => `[${typeof t === "string" ? "tx" + (i + 1) : t.fn}](${typeof t === "string" ? t : t.url})`).join(" · "));
  out.push(`_${DISCLAIMER}_`);
  return out.join("\n\n");
}
