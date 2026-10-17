import { createPublicClient, createWalletClient, http, parseEventLogs, zeroAddress, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { foglineAbi, mockUsdcAbi } from "./abi.js";
import { commitments, randomLayout, type Layout } from "./layout.js";
import { loadLayout, saveLayout } from "./secrets.js";
import type { GameState, MatchView, PieceView } from "./rules.js";

export const ALLOWED_CHAINS: Record<number, Chain> = { 84532: baseSepolia, 31337: foundry };

export interface ClientOpts { rpcUrl: string; chainId: number; game: Address; privateKey: Hex }

/** Thin typed wrapper over the Fogline contract for one player/agent. */
export class FoglineClient {
  readonly pub: PublicClient<Transport, Chain>; readonly wallet: WalletClient<Transport, Chain, Account>; readonly account: Account; readonly game: Address; readonly chainId: number;
  constructor(o: ClientOpts) {
    const chain = ALLOWED_CHAINS[o.chainId];
    if (!chain) throw new Error(`Fogline is testnet-only; chainId ${o.chainId} refused`);
    this.chainId = o.chainId;
    this.game = o.game;
    this.account = privateKeyToAccount(o.privateKey);
    const pollingInterval = o.chainId === 31337 ? 25 : 1000;
    this.pub = createPublicClient({ chain, transport: http(o.rpcUrl), pollingInterval }) as PublicClient<Transport, Chain>;
    this.wallet = createWalletClient({ chain, transport: http(o.rpcUrl), account: this.account, pollingInterval });
  }
  get address(): Address { return this.account.address; }

  private async send(functionName: string, args: readonly unknown[], address: Address = this.game, abi: any = foglineAbi) {
    const { request } = await this.pub.simulateContract({ address, abi, functionName, args, account: this.account } as any);
    const hash = await this.wallet.writeContract(request as any);
    const rcpt = await this.pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return rcpt;
  }

  async faucetAndApprove(token: Address, amount: bigint) {
    await this.send("faucet", [], token, mockUsdcAbi);
    await this.send("approve", [this.game, amount], token, mockUsdcAbi);
  }

  async createMatch(opts: { token?: Address; stake?: bigint; turnTimeout?: number; opponent?: Address } = {}): Promise<bigint> {
    const rcpt = await this.send("createMatch", [opts.token ?? zeroAddress, opts.stake ?? 0n, opts.turnTimeout ?? 600, opts.opponent ?? zeroAddress]);
    const logs = parseEventLogs({ abi: foglineAbi, logs: rcpt.logs, eventName: "MatchCreated" });
    return (logs[0] as any).args.id as bigint;
  }
  joinMatch(id: bigint) { return this.send("joinMatch", [id]); }
  cancelMatch(id: bigint) { return this.send("cancelMatch", [id]); }
  resign(id: bigint) { return this.send("resign", [id]); }
  claimTimeout(id: bigint) { return this.send("claimTimeout", [id]); }
  claimUnverified(id: bigint) { return this.send("claimUnverified", [id]); }

  /** Generate (or reuse) a secret layout, store it locally, commit its hashes. */
  async commitLayout(id: bigint, side: number, layout?: Layout): Promise<Layout> {
    const l = layout ?? this.layout(id) ?? randomLayout(side);
    saveLayout(this.chainId, this.game, id, this.address, l);
    await this.send("commitLayout", [id, commitments(id, this.address, l)]);
    return l;
  }
  layout(id: bigint) { return loadLayout(this.chainId, this.game, id, this.address); }

  move(id: bigint, from: number, to: number, rank: number, salt: Hex) { return this.send("move", [id, from, to, rank, salt]); }
  revealDefense(id: bigint, rank: number, salt: Hex) { return this.send("revealDefense", [id, rank, salt]); }
  verifyLayout(id: bigint, l: Layout) { return this.send("verifyLayout", [id, l.ranks, l.salts]); }

  async state(id: bigint): Promise<GameState> {
    const [m, board, pieces] = await Promise.all([
      this.pub.readContract({ address: this.game, abi: foglineAbi, functionName: "getMatch", args: [id] }),
      this.pub.readContract({ address: this.game, abi: foglineAbi, functionName: "getBoard", args: [id] }),
      this.pub.readContract({ address: this.game, abi: foglineAbi, functionName: "getPieces", args: [id] }),
    ]);
    const mm = m as any;
    const match: MatchView = {
      players: mm.players, token: mm.token, stake: mm.stake, turnTimeout: Number(mm.turnTimeout), phase: Number(mm.phase),
      turn: Number(mm.turn), winner: Number(mm.winner), reason: Number(mm.reason), deadline: mm.deadline, ply: Number(mm.ply),
      pendFrom: Number(mm.pendFrom), pendTo: Number(mm.pendTo), committed: mm.committed, verified: mm.verified,
    };
    return { id, match, board: (board as readonly number[]).map(Number), pieces: (pieces as readonly any[]).map((p) => ({ ...p, pos: Number(p.pos), rank: Number(p.rank) })) as PieceView[] };
  }

  sideOf(state: GameState): number {
    const me = this.address.toLowerCase();
    if (state.match.players[0].toLowerCase() === me) return 0;
    if (state.match.players[1].toLowerCase() === me) return 1;
    return -1;
  }

  async now(): Promise<bigint> { return (await this.pub.getBlock()).timestamp; }
}
