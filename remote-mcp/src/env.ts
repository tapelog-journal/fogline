// Bindings and config for the Fogline remote MCP Worker. Testnet only (Base Sepolia, chain 84532).
import type { Address } from "viem";

export interface Env {
  PLAYER: DurableObjectNamespace<import("./player").Player>;
  HOUSE: DurableObjectNamespace<import("./house").House>;
  FUNDER: DurableObjectNamespace<import("./funder").Funder>;
  SSE: DurableObjectNamespace<import("./sse").SseSession>;
  CHAIN_ID: string;
  RPC_URL: string;
  /** comma-separated fallback RPCs */
  RPC_FALLBACKS?: string;
  GAME: string;
  TOKEN: string;
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
  return { chainId, rpcUrl: [env.RPC_URL, ...(env.RPC_FALLBACKS ?? "").split(",")].map((u) => u.trim()).filter(Boolean).join(","), game: env.GAME as Address, token: env.TOKEN as Address, watchBase: env.WATCH_BASE };
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
