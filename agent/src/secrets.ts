// Local secret storage for layouts and bot keys. Lives OUTSIDE any repo (default ~/.fogline), files chmod 600.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import type { Layout } from "./layout.js";

export const SECRET_DIR = process.env.FOGLINE_HOME ?? join(homedir(), ".fogline");

function ensureDir(d: string) { if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 }); }
function writeSecret(path: string, data: string) { writeFileSync(path, data, { mode: 0o600 }); chmodSync(path, 0o600); }

export function layoutPath(chainId: number, game: string, matchId: bigint, player: string) {
  return join(SECRET_DIR, "layouts", `${chainId}-${game.toLowerCase()}-${matchId}-${player.toLowerCase()}.json`);
}
export function saveLayout(chainId: number, game: string, matchId: bigint, player: string, l: Layout) {
  ensureDir(join(SECRET_DIR, "layouts"));
  writeSecret(layoutPath(chainId, game, matchId, player), JSON.stringify(l));
}
export function loadLayout(chainId: number, game: string, matchId: bigint, player: string): Layout | undefined {
  const p = layoutPath(chainId, game, matchId, player);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Layout) : undefined;
}

/** Load (or create) a throwaway testnet bot key by name. Never print it. */
export function botKey(name: string): Hex {
  const dir = join(SECRET_DIR, "keys");
  ensureDir(dir);
  const p = join(dir, `${name}.key`);
  if (!existsSync(p)) writeSecret(p, generatePrivateKey());
  return readFileSync(p, "utf8").trim() as Hex;
}
