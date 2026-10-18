// Bindings and config for the Fogline remote MCP Worker. Testnet only (Base Sepolia, chain 84532).
import type { Address } from "viem";

export interface Env {
  PLAYER: DurableObjectNamespace<import("./player").Player>;
  HOUSE: DurableObjectNamespace<import("./house").House>;
  FUNDER: DurableObjectNamespace<import("./funder").Funder>;
  SSE: DurableObjectNamespace<import("./sse").SseSession>;
  RENDER: DurableObjectNamespace<import("./renderer").Renderer>;
  LADDER: DurableObjectNamespace<import("./ladder").Ladder>;
  CHAIN_ID: string;
  RPC_URL: string;
  /** comma-separated fallback RPCs */
  RPC_FALLBACKS?: string;
  GAME: string;
  TOKEN: string;
  COSMETICS: string;
  WATCH_BASE: string;
  /** secrets (wrangler secret put) */
  FUNDER_KEY: string;
  HOUSE_KEY: string;
  IP_SALT: string;
}

export const ALLOWED_CHAIN_ID = 84532;

export function cfg(env: Env) {
  const chainId = Number(env.CHAIN_ID);
  if (chainId !== ALLOWED_CHAIN_ID) throw new Error(`Fogline remote MCP is Base Sepolia testnet only; chainId ${env.CHAIN_ID} refused`);
  return { chainId, rpcUrl: [env.RPC_URL, ...(env.RPC_FALLBACKS ?? "").split(",")].map((u) => u.trim()).filter(Boolean).join(","), game: env.GAME as Address, token: env.TOKEN as Address, cosmetics: env.COSMETICS as Address, watchBase: env.WATCH_BASE };
}

export const DISCLAIMER = "Game for entertainment. Testnet only. Not investment advice.";

export function watchLink(env: Env, id: bigint | number | string) {
  return `${env.WATCH_BASE}?game=${env.GAME}&match=${id}`;
}
export const txLink = (h: string) => `https://sepolia.basescan.org/tx/${h}`;

/** Funding policy (Base Sepolia ETH, valueless). */
export const FUNDING = {
  grantWei: 100_000_000_000_000n, // 0.0001 ETH per new player (~5 full matches of gas)
  topUpWei: 50_000_000_000_000n, // 0.00005 ETH top-up
  topUpBelowWei: 30_000_000_000_000n, // only when balance < 0.00003 ETH
  maxTopUpsPerSessionPerDay: 2,
  maxGrantsPerIpPerDay: 10, // ChatGPT/Claude call from shared provider IPs, so this is generous
  maxGrantsPerDay: 40, // global cap on new funded players per UTC day
  maxTopUpsPerDay: 40,
  funderFloorWei: 1_000_000_000_000_000n, // stop granting players when funder < 0.001 ETH (reserved for the house bot)
  houseMinWei: 300_000_000_000_000n, // top up house bot when below 0.0003 ETH
  houseTopUpWei: 1_000_000_000_000_000n, // with 0.001 ETH
};

export const MAX_HOUSE_MATCHES = 12;
export const DEFAULT_TURN_TIMEOUT = 600; // seconds per turn (contract min 60)

/** Renderer shard for a match (board pictures are CPU-heavy; spread matches over a few Durable Objects). */
export const renderer = (env: Env, matchId: string | bigint) => env.RENDER.get(env.RENDER.idFromName(`render-${BigInt(matchId) % 8n}`));
export const DEFAULT_LOOK_PAIR = (): [import("./render").Look, import("./render").Look] => [0, 1].map(() => ({ skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] })) as any;
export const ladder = (env: Env) => env.LADDER.get(env.LADDER.idFromName("ladder"));
