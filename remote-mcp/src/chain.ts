// Minimal, subrequest-frugal chain access for Workers. One batched JSON-RPC call for reads,
// local signing, raw send, receipt polling. Base Sepolia only.
import { createPublicClient, decodeErrorResult, encodeFunctionData, fallback, http, parseEventLogs, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { foglineAbi, mockUsdcAbi } from "../../agent/src/abi";
import type { GameState, MatchView, PieceView } from "../../agent/src/rules";
import { ALLOWED_CHAIN_ID } from "./env";

export { foglineAbi, mockUsdcAbi };

const clients = new Map<string, ReturnType<typeof mk>>();
/** `rpc` may be a comma-separated list: the first is primary, the rest are fallbacks (public RPCs rate-limit shared egress IPs). */
function mk(rpc: string) {
  const urls = rpc.split(",").map((u) => u.trim()).filter(Boolean);
  const transports = urls.map((u) => http(u, { batch: { wait: 0 }, retryCount: 1, retryDelay: 400, timeout: 12_000 }));
  return createPublicClient({ chain: baseSepolia, transport: transports.length > 1 ? fallback(transports, { retryCount: 2, retryDelay: 600 }) : transports[0] });
}
export function pub(rpc: string) {
  let c = clients.get(rpc);
  if (!c) { c = mk(rpc); clients.set(rpc, c); }
  return c;
}

let chainChecked = false;
export async function assertChain(rpc: string) {
  if (chainChecked) return;
  const id = await pub(rpc).getChainId();
  if (id !== ALLOWED_CHAIN_ID) throw new Error(`RPC reports chainId ${id}; Fogline remote MCP refuses anything but ${ALLOWED_CHAIN_ID}`);
  chainChecked = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SentTx { fn: string; hash: Hex; receipt: TransactionReceipt }

/** Per-key nonce floor, persisted by the caller (Durable Object storage). */
export interface NonceStore { get(): Promise<number | undefined>; set(n: number): Promise<void> }

export async function sendTx(opts: {
  rpc: string; key: Hex; to: Address; data?: Hex; value?: bigint; fn: string; nonces: NonceStore; attempts?: number;
}): Promise<SentTx> {
  await assertChain(opts.rpc);
  const c = pub(opts.rpc);
  const acct = privateKeyToAccount(opts.key);
  const attempts = opts.attempts ?? 4;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const [gas, pending, gasPrice] = await Promise.all([
        c.estimateGas({ account: acct.address, to: opts.to, data: opts.data, value: opts.value }),
        c.getTransactionCount({ address: acct.address, blockTag: "pending" }),
        c.getGasPrice(),
      ]);
      const floor = await opts.nonces.get();
      const nonce = Math.max(pending, floor ?? 0);
      const signed = await acct.signTransaction({
        chainId: ALLOWED_CHAIN_ID, type: "eip1559", nonce, to: opts.to, data: opts.data, value: opts.value ?? 0n,
        gas: (gas * 13n) / 10n + 5000n, maxFeePerGas: gasPrice * 3n, maxPriorityFeePerGas: gasPrice < 1_000_000n ? gasPrice : 1_000_000n,
      });
      const hash = await c.sendRawTransaction({ serializedTransaction: signed });
      await opts.nonces.set(nonce + 1);
      const receipt = await waitReceipt(opts.rpc, hash);
      if (receipt.status !== "success") throw new Error(`${opts.fn} reverted onchain: ${hash}`);
      return { fn: opts.fn, hash, receipt };
    } catch (e: any) {
      lastErr = withRevertName(e);
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      if (/nonce too low|already known|replacement/i.test(msg)) { const f = await opts.nonces.get(); await opts.nonces.set((f ?? 0) + 1); }
      if (i < attempts) await sleep(1500 * i);
    }
  }
  throw lastErr;
}

export async function waitReceipt(rpc: string, hash: Hex, timeoutMs = 40_000): Promise<TransactionReceipt> {
  const c = pub(rpc);
  const t0 = Date.now();
  await sleep(1200);
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await c.getTransactionReceipt({ hash }); if (r) return r; } catch { /* not yet */ }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${hash}`);
}

export const gameCall = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi: foglineAbi as any, functionName, args } as any);
export const tokenCall = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi: mockUsdcAbi as any, functionName, args } as any);

export async function readState(rpc: string, game: Address, id: bigint, minBlock?: bigint): Promise<GameState & { block: bigint }> {
  const c = pub(rpc);
  for (let i = 0; ; i++) {
    const [m, board, pieces, block] = await Promise.all([
      c.readContract({ address: game, abi: foglineAbi, functionName: "getMatch", args: [id] }),
      c.readContract({ address: game, abi: foglineAbi, functionName: "getBoard", args: [id] }),
      c.readContract({ address: game, abi: foglineAbi, functionName: "getPieces", args: [id] }),
      c.getBlockNumber({ cacheTime: 0 }),
    ]);
    // public RPC is load balanced; if a node lags behind a tx we just saw, ask again
    if (minBlock !== undefined && block < minBlock && i < 6) { await sleep(700); continue; }
    const mm = m as any;
    const match: MatchView = {
      players: mm.players, token: mm.token, stake: mm.stake, turnTimeout: Number(mm.turnTimeout), phase: Number(mm.phase),
      turn: Number(mm.turn), winner: Number(mm.winner), reason: Number(mm.reason), deadline: mm.deadline, ply: Number(mm.ply),
      pendFrom: Number(mm.pendFrom), pendTo: Number(mm.pendTo), committed: mm.committed, verified: mm.verified,
    };
    return {
      id, block, match, board: (board as readonly number[]).map(Number),
      pieces: (pieces as readonly any[]).map((p) => ({ ...p, pos: Number(p.pos), rank: Number(p.rank) })) as PieceView[],
    };
  }
}

export async function latestTimestamp(rpc: string): Promise<bigint> {
  return (await pub(rpc).getBlock()).timestamp;
}

export function matchIdFrom(receipt: TransactionReceipt): bigint {
  const logs = parseEventLogs({ abi: foglineAbi, logs: receipt.logs, eventName: "MatchCreated" });
  return (logs[0] as any).args.id as bigint;
}

const OUTCOME = ["attacker wins", "defender holds", "both removed"];
export function combatNote(receipt: TransactionReceipt, names: string[]): string {
  const ev = parseEventLogs({ abi: foglineAbi, logs: receipt.logs, eventName: "Combat" })[0] as any;
  if (!ev) return "";
  const a = ev.args;
  return `${names[a.attackerRank]} attacked ${names[a.defenderRank]}: ${OUTCOME[a.outcome]}`;
}

/** Attach the decoded custom error name (e.g. NotYourTurn) to a viem error message. */
export function withRevertName(e: any) {
  try {
    let data: Hex | undefined;
    let x = e;
    for (let i = 0; x && i < 8; i++) { if (typeof x.data === "string" && x.data.startsWith("0x")) { data = x.data; break; } if (typeof x.data?.data === "string") { data = x.data.data; break; } x = x.cause; }
    if (data && data.length >= 10) {
      const d = decodeErrorResult({ abi: [...(foglineAbi as any), ...(mockUsdcAbi as any)], data });
      return new Error(`reverted: ${d.errorName}${d.args?.length ? "(" + d.args.join(",") + ")" : ""}`);
    }
  } catch { /* fall through */ }
  return e;
}

/** Plain-language narration of match events in [fromBlock, toBlock] from `side`'s point of view, with a1-h8 coordinates. */
export async function narrate(rpc: string, game: Address, id: bigint, fromBlock: bigint, toBlock: bigint, side: number, names: string[]): Promise<{ lines: string[]; last?: { from: number; to: number } } | undefined> {
  const co = (sq: number) => `${"abcdefgh"[sq % 8]}${Math.floor(sq / 8) + 1}`;
  try {
    if (toBlock < fromBlock) return { lines: [] };
    if (toBlock - fromBlock > 5000n) fromBlock = toBlock - 5000n;
    const logs = await pub(rpc).getLogs({ address: game, fromBlock, toBlock, topics: [null, `0x${id.toString(16).padStart(64, "0")}` as Hex] } as any);
    // some RPCs ignore the topic filter: always filter by match id ourselves
    const ev = (parseEventLogs({ abi: foglineAbi, logs: logs as any }) as any[]).filter((e) => e.args?.id === id);
    const who = (s: number) => (s === side ? "You" : "Opponent");
    const whose = (pid: number) => (Math.floor(pid / 16) === side ? "your" : "their");
    const OUT = ["attacker wins", "defender holds", "both removed"];
    const lines: string[] = [];
    let last: { from: number; to: number } | undefined;
    for (const e of ev as any[]) {
      const a = e.args;
      switch (e.eventName) {
        case "Moved": lines.push(`${who(Number(a.side))} moved ${co(a.from)} → ${co(a.to)}`); last = { from: Number(a.from), to: Number(a.to) }; break;
        case "Attack": lines.push(`${who(Number(a.side))} attacked ${co(a.from)} → ${co(a.to)}`); last = { from: Number(a.from), to: Number(a.to) }; break;
        case "Combat": lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + `: ${whose(Number(a.attackerId))} ${names[a.attackerRank]} vs ${whose(Number(a.defenderId))} ${names[a.defenderRank]}, ${OUT[a.outcome]}`; break;
        case "GameEnded": lines.push(Number(a.winner) === 2 ? "Game ended in a draw" : Number(a.winner) === side ? "GAME OVER: you won! 🏆" : "GAME OVER: the opponent won"); break;
        case "LayoutVerified": lines.push(Number(a.side) === side ? "Your army was verified onchain" : "Opponent's army was verified onchain"); break;
        case "Settled": lines.push("Match settled onchain"); break;
      }
    }
    return { lines, last };
  } catch (e) { console.log("narrate failed", String(e).slice(0, 200)); return undefined; }
}

export interface LastActionInfo { from: number; to: number; side: number; attack: boolean; outcome?: number; attackerRank?: number; defenderRank?: number }
/** The two most recent moves/attacks in a match, oldest first (public onchain events only), searched over the last `span` blocks. */
export async function lastActions(rpc: string, game: Address, id: bigint, toBlock: bigint, span = 3000n): Promise<LastActionInfo[]> {
  try {
    const fromBlock = toBlock > span ? toBlock - span : 0n;
    const logs = await pub(rpc).getLogs({ address: game, fromBlock, toBlock, topics: [null, `0x${id.toString(16).padStart(64, "0")}` as Hex] } as any);
    const ev = (parseEventLogs({ abi: foglineAbi, logs: logs as any }) as any[]).filter((e) => e.args?.id === id);
    const acts: LastActionInfo[] = [];
    for (const e of ev) {
      const a = e.args, last = acts[acts.length - 1];
      if (e.eventName === "Moved") acts.push({ from: Number(a.from), to: Number(a.to), side: Number(a.side), attack: false });
      else if (e.eventName === "Attack") acts.push({ from: Number(a.from), to: Number(a.to), side: Number(a.side), attack: true });
      else if (e.eventName === "Combat" && last?.attack) Object.assign(last, { outcome: Number(a.outcome), attackerRank: Number(a.attackerRank), defenderRank: Number(a.defenderRank) });
    }
    return acts.slice(-2);
  } catch (e) { console.log("lastActions failed", String(e).slice(0, 160)); return []; }
}
