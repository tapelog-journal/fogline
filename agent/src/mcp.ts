#!/usr/bin/env node
// MCP server so AI assistants can play Fogline. Testnet / local only.
// Secrets (layout salts, bot key) stay on this machine and are never returned to the model.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { FoglineClient } from "./client.js";
import { botStep } from "./bot.js";
import { envConfig } from "./config.js";
import { botKey } from "./secrets.js";
import { END_REASONS, legalMoves, Phase, renderBoard } from "./rules.js";

const cfg = envConfig();
const key = (process.env.FOGLINE_PRIVATE_KEY as Hex) ?? botKey(`${process.env.FOGLINE_KEY_NAME ?? "mcp"}-${cfg.chainId}`);
const c = new FoglineClient({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, game: cfg.game as Address, privateKey: key });
const server = new McpServer({ name: "fogline", version: "0.1.0" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t + "\n\nGame for entertainment. Not investment advice." }] });

async function describe(id: bigint) {
  const s = await c.state(id), side = c.sideOf(s), l = c.layout(id);
  const moves = side >= 0 && l && s.match.phase === Phase.Playing && s.match.turn === side ? legalMoves(s, side, l.ranks) : [];
  return `match #${id} phase=${Phase[s.match.phase]} turn=side ${s.match.turn} you=side ${side} ply=${s.match.ply} winner=${s.match.winner} reason=${END_REASONS[s.match.reason]}\n` +
    renderBoard(s, side >= 0 && l ? { side, ranks: l.ranks } : undefined) +
    (moves.length ? `\nlegal moves (from->to): ${moves.map((m) => `${m.from}->${m.to}${m.attack ? "x" : ""}`).join(" ")}` : "");
}

server.tool("fogline_rules", "Explain Fogline's rules and piece set", {}, async () => text(
  "8x8 board, 16 hidden pieces each; fog banks at squares 26 and 37. Ranks: Beacon(0, immobile, capture to win) Ghost(1, beats Warden when attacking) Scout(2, moves up to 3) Sapper(3, defuses Mines) Guard(4) Knight(5) Captain(6) Warden(7) Mine(8, immobile, single-use). Higher rank wins; ties: defender holds. Squares are row*8+col."));
server.tool("fogline_address", "This agent's wallet address", {}, async () => text(c.address));
server.tool("fogline_create", "Create a match (stake in test fUSD, 0 for free)", { stake: z.number().min(0).default(0), opponent: z.string().optional() }, async ({ stake, opponent }) => {
  const s = BigInt(Math.round(stake * 1e6));
  if (s > 0n) await c.faucetAndApprove(cfg.token, s);
  const id = await c.createMatch({ token: s > 0n ? cfg.token : undefined, stake: s, opponent: opponent as Address | undefined });
  return text(`created match #${id}`);
});
server.tool("fogline_join", "Join a match", { matchId: z.number().int() }, async ({ matchId }) => {
  const s = await c.state(BigInt(matchId));
  if (s.match.stake > 0n) await c.faucetAndApprove(cfg.token, s.match.stake);
  await c.joinMatch(BigInt(matchId));
  return text(`joined #${matchId}`);
});
server.tool("fogline_state", "Show the board from this agent's point of view, plus legal moves", { matchId: z.number().int() }, async ({ matchId }) => text(await describe(BigInt(matchId))));
server.tool("fogline_move", "Move a piece (reveals automatically when required)", { matchId: z.number().int(), from: z.number().int(), to: z.number().int() }, async ({ matchId, from, to }) => {
  const id = BigInt(matchId), s = await c.state(id), l = c.layout(id);
  if (!l) return text("no local layout for this match; commit first with fogline_auto_step");
  const i = (s.board[from] - 1) % 16;
  await c.move(id, from, to, l.ranks[i], l.salts[i]);
  return text(await describe(id));
});
server.tool("fogline_auto_step", "Let the baseline bot take the next required action (commit, reveal, move, verify, claim)", { matchId: z.number().int() }, async ({ matchId }) => {
  const { log } = await botStep(c, BigInt(matchId));
  return text(log + "\n" + (await describe(BigInt(matchId))));
});
server.tool("fogline_resign", "Resign a match", { matchId: z.number().int() }, async ({ matchId }) => { await c.resign(BigInt(matchId)); return text("resigned"); });

await server.connect(new StdioServerTransport());
