import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address } from "viem";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Deployment { chainId: number; game: Address; token: Address; cosmetics: Address }

export function loadDeployment(chainId: number): Deployment {
  const p = join(REPO_ROOT, "deployments", `${chainId}.json`);
  if (!existsSync(p)) throw new Error(`no deployment for chain ${chainId} at ${p}; run forge script script/Deploy.s.sol first`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export const DEFAULT_RPC: Record<number, string> = { 31337: "http://127.0.0.1:8545", 84532: "https://sepolia.base.org" };

export function envConfig() {
  const chainId = Number(process.env.FOGLINE_CHAIN_ID ?? 31337);
  const rpcUrl = process.env.FOGLINE_RPC ?? DEFAULT_RPC[chainId];
  const dep = loadDeployment(chainId);
  return { ...dep, chainId, rpcUrl, game: (process.env.FOGLINE_GAME as Address) ?? dep.game };
}
