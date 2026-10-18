// Full public move history of a match, rebuilt from onchain events, in the viewer's replay format.
// Public RPC limits: sepolia.base.org caps eth_getLogs at 200 blocks and some RPCs ignore topic filters,
// so logs are fetched in chunks from a logs-friendly RPC and always filtered by match id here.
import { createPublicClient, encodeEventTopics, http, parseEventLogs, type Address, type Hex } from "viem";
import { END_REASONS, Phase, PIECES, RANK_NAMES } from "../../agent/src/rules";
import { foglineAbi, readState } from "./chain";

export const GAME_DEPLOY_BLOCK = 48247237n; // FoglineGame on Base Sepolia (broadcast/Deploy.s.sol/84532)
const LOG_RPCS = ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"];
const SPAN: Record<string, bigint> = { "https://base-sepolia-rpc.publicnode.com": 9_999n, "https://sepolia.base.org": 199n };
const clients = new Map<string, any>();
const client = (u: string) => { if (!clients.has(u)) clients.set(u, createPublicClient({ transport: http(u, { retryCount: 1, retryDelay: 300, timeout: 15_000 }) })); return clients.get(u); };
export const head = () => client(LOG_RPCS[0]).getBlockNumber({ cacheTime: 0 }) as Promise<bigint>;

const co = (sq: number) => `${"abcdefgh"[sq % 8]}${Math.floor(sq / 8) + 1}`;

/** getLogs over [from, to] in RPC-sized chunks; `topics` as in eth_getLogs. Max `maxCalls` requests. */
export async function chunkedLogs(game: Address, from: bigint, to: bigint, topics: (Hex | null)[], maxCalls = 30): Promise<any[]> {
  const out: any[] = [];
  let calls = 0;
  for (let a = from; a <= to; ) {
    let got = false, lastErr: unknown;
    for (const u of LOG_RPCS) {
      const b = a + SPAN[u] > to ? to : a + SPAN[u];
      if (u !== LOG_RPCS[0] && to - a > 2_000n) continue; // tiny-range RPC only as a last resort for short spans
      try {
        if (++calls > maxCalls) throw new Error("history too long to load in one request");
        out.push(...(await client(u).getLogs({ address: game, fromBlock: a, toBlock: b, topics } as any)));
        a = b + 1n; got = true; break;
      } catch (e) { lastErr = e; if (String(e).includes("too long")) throw e; }
    }
    if (!got) throw new Error(`log fetch failed: ${String((lastErr as any)?.shortMessage ?? lastErr).slice(0, 120)}`);
  }
  return out;
}

export interface Snapshot { step: number; log: string; tx: string; block: string; state: any }
export interface History { chainId: number; game: string; matchId: string; players: string[]; winner: number; reason: string; plies: number; done: boolean; snapshots: Snapshot[]; toBlock: string }

const idTopic = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}` as Hex;

/** Rebuild public snapshots (hidden ranks stay hidden) from the events of one match. */
export function buildSnapshots(id: bigint, logs: any[], game: string): Omit<History, "toBlock"> {
  const ev = (parseEventLogs({ abi: foglineAbi, logs }) as any[]).filter((e) => e.args?.id === id)
    .sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : Number(x.blockNumber - y.blockNumber)));
  const board = Array(64).fill(0);
  const pieces = Array.from({ length: 32 }, (_, pid) => ({ commitment: "0x", pos: pid < PIECES ? pid : 48 + (pid - PIECES), rank: 0, alive: true, revealed: false, moved: false }));
  const match: any = { players: ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"], token: "0x0000000000000000000000000000000000000000", stake: "0", turnTimeout: 0, phase: Phase.Open, turn: 0, winner: 2, reason: 0, deadline: "0", ply: 0, pendFrom: 0, pendTo: 0, committed: [false, false], verified: [false, false] };
  const snaps: Snapshot[] = [];
  const snap = (log: string, e: any) => snaps.push({ step: snaps.length + 1, log, tx: e.transactionHash, block: String(e.blockNumber), state: { id: id.toString(), match: JSON.parse(JSON.stringify(match)), board: [...board], pieces: pieces.map((p) => ({ ...p })) } });
  let pendingReveal: string[] = []; // reveals in the current tx, appended to that tx's move line
  let lastTx = "";
  const OUT = ["attacker wins", "defender holds", "both removed"];
  for (const e of ev) {
    const a = e.args;
    if (e.transactionHash !== lastTx) { pendingReveal = []; lastTx = e.transactionHash; }
    switch (e.eventName) {
      case "MatchCreated": match.players = [a.creator, a.opponent]; match.stake = String(a.stake); match.token = a.token; match.turnTimeout = Number(a.turnTimeout); snap(`match created by ${String(a.creator).slice(0, 8)}…`, e); break;
      case "MatchJoined": match.players = [match.players[0], a.player]; match.phase = Phase.Committing; snap("side 1 joined", e); break;
      case "LayoutCommitted": match.committed[Number(a.side)] = true; snap(`side ${a.side} committed a hidden army`, e);
        if (match.committed[0] && match.committed[1]) { for (let pid = 0; pid < 32; pid++) board[pieces[pid].pos] = pid + 1; snaps[snaps.length - 1].state.board = [...board]; }
        break;
      case "GameStarted": match.phase = Phase.Playing; match.turn = 0; for (let pid = 0; pid < 32; pid++) board[pieces[pid].pos] = pid + 1; break;
      case "Revealed": { const p = pieces[Number(a.pieceId)]; p.revealed = true; p.rank = Number(a.rank); pendingReveal.push(RANK_NAMES[p.rank]); break; }
      case "Moved": {
        const f = Number(a.from), t = Number(a.to), pid = board[f] - 1;
        if (pid >= 0) { board[f] = 0; board[t] = pid + 1; pieces[pid].pos = t; pieces[pid].moved = true; }
        match.ply = Number(a.ply) + 1; match.turn = 1 - Number(a.side);
        snap(`side ${a.side} moves ${f}->${t} [${co(f)}→${co(t)}]${pendingReveal.length ? ` (reveals ${pendingReveal.join(", ")})` : ""}`, e); pendingReveal = [];
        break;
      }
      case "Attack": {
        const f = Number(a.from), t = Number(a.to), pid = board[f] - 1;
        if (pid >= 0) pieces[pid].moved = true;
        match.pendFrom = f; match.pendTo = t; match.phase = Phase.PendingReveal; match.turn = 1 - Number(a.side);
        snap(`side ${a.side} ATTACKS ${f}->${t} [${co(f)}→${co(t)}]${pendingReveal.length ? ` (reveals ${pendingReveal.join(", ")})` : ""}`, e); pendingReveal = [];
        break;
      }
      case "Combat": {
        const aId = Number(a.attackerId), dId = Number(a.defenderId), outc = Number(a.outcome), f = match.pendFrom, t = match.pendTo;
        const A = pieces[aId], D = pieces[dId];
        A.revealed = D.revealed = true; A.rank = Number(a.attackerRank); D.rank = Number(a.defenderRank);
        if (outc === 0) { D.alive = false; board[t] = aId + 1; board[f] = 0; A.pos = t; }
        else if (outc === 1) { A.alive = false; board[f] = 0; }
        else { A.alive = false; D.alive = false; board[f] = 0; board[t] = 0; }
        const attSide = Math.floor(aId / PIECES);
        match.phase = Phase.Playing; match.ply += 1; match.turn = 1 - attSide;
        const same = snaps.length && snaps[snaps.length - 1].tx === e.transactionHash; // defender was already revealed
        const line = `${RANK_NAMES[A.rank]} vs ${RANK_NAMES[D.rank]}: ${OUT[outc]}`;
        if (same) { snaps.pop(); snap(`side ${attSide} ATTACKS ${f}->${t} [${co(f)}→${co(t)}]: ${line}`, e); }
        else snap(`side ${1 - attSide} reveals defender ${RANK_NAMES[D.rank]} -> ${line}`, e);
        break;
      }
      case "GameEnded": {
        match.phase = Phase.Ended; match.winner = Number(a.winner); match.reason = Number(a.reason);
        const r = END_REASONS[match.reason] ?? "";
        if (snaps.length && snaps[snaps.length - 1].tx === e.transactionHash) { const s = snaps[snaps.length - 1]; s.state.match.phase = match.phase; s.state.match.winner = match.winner; s.state.match.reason = match.reason; s.log += ` · game over (${r})`; }
        else snap(match.winner === 2 ? `draw (${r})` : `side ${match.winner} wins (${r})`, e);
        break;
      }
      case "LayoutVerified": match.verified[Number(a.side)] = true; snap(`side ${a.side} proves a legal army${match.stake !== "0" ? " and collects" : ""}`, e); break;
      case "Settled": match.phase = Phase.Settled; if (snaps.length && snaps[snaps.length - 1].tx === e.transactionHash) snaps[snaps.length - 1].state.match.phase = Phase.Settled; else snap("match settled", e); break;
    }
  }
  return { chainId: 84532, game, matchId: id.toString(), players: match.players, winner: match.winner, reason: END_REASONS[match.reason] ?? "None", plies: match.ply, done: match.phase === Phase.Settled, snapshots: snaps };
}

/** Loads a match's history. `fromBlock` = block the match was created in (or the deploy block). */
export async function loadHistory(rpc: string, game: Address, id: bigint, fromBlock: bigint): Promise<History> {
  const to = await head();
  const logs = await chunkedLogs(game, fromBlock, to, [null, idTopic(id)]);
  const h = buildSnapshots(id, logs, game);
  // final position straight from the chain (includes the winner's army revealed by the end-of-game check)
  if (h.snapshots.length) {
    try {
      const s = await readState(rpc, game, id);
      const last = h.snapshots[h.snapshots.length - 1].state;
      if (Number(s.match.ply) === Number(last.match.ply) || s.match.phase >= Phase.Ended) {
        last.board = s.board; last.pieces = s.pieces.map((p) => ({ ...p, commitment: "0x" }));
        last.match = { ...last.match, phase: s.match.phase, winner: s.match.winner, reason: s.match.reason, ply: s.match.ply, turn: s.match.turn, verified: s.match.verified, deadline: String(s.match.deadline) };
      }
      h.done = s.match.phase === Phase.Settled;
      h.plies = Number(s.match.ply);
    } catch { /* keep event-built state */ }
  }
  return { ...h, toBlock: to.toString() };
}

/** Block range scan for MatchCreated, used to index match id -> creation block. */
export async function scanCreated(game: Address, from: bigint, to: bigint): Promise<Record<string, string>> {
  const topic0 = encodeEventTopics({ abi: foglineAbi, eventName: "MatchCreated" } as any)[0] as Hex;
  const logs = await chunkedLogs(game, from, to, [topic0], 60);
  const out: Record<string, string> = {};
  for (const e of parseEventLogs({ abi: foglineAbi, logs, eventName: "MatchCreated" }) as any[]) out[String(e.args.id)] = String(e.blockNumber);
  return out;
}
