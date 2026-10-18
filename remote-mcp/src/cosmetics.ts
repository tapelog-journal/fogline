// Reads which decorative Fogline cosmetics a wallet owns / has equipped (ERC-1155 on Base Sepolia).
// Cosmetics never affect gameplay. Test fUSD only. Game for entertainment. Not investment advice.
// @ts-ignore plain JS module shared with the GitHub Pages viewer
import { CATALOG } from "../../docs/art/catalog.js";
import { encodeFunctionData, type Address } from "viem";
import { cosmeticsAbi } from "../../agent/src/abi";
import { pub } from "./chain";
import { DEFAULT_LOOK, type Look } from "./render";

export { cosmeticsAbi };
export interface Item { id: number; name: string; category: string; kind: number; rarity: string; price: number; max: number; desc: string }
export const ITEMS: Item[] = CATALOG;
const RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };
const CAT_KEY: Record<string, keyof Look> = { skin: "skin", table: "table", fog: "fog", trail: "trail", banner: "banner" };

export interface Owned { owned: number[]; equipped: [number, number] }

export async function ownedBy(rpc: string, cosmetics: Address, addr: Address): Promise<Owned> {
  const c = pub(rpc), ids = ITEMS.map((i) => BigInt(i.id));
  const [bals, e0, e1] = await Promise.all([
    c.readContract({ address: cosmetics, abi: cosmeticsAbi, functionName: "balanceOfBatch", args: [ids.map(() => addr), ids] }) as Promise<readonly bigint[]>,
    c.readContract({ address: cosmetics, abi: cosmeticsAbi, functionName: "equipped", args: [addr, 0] }) as Promise<bigint>,
    c.readContract({ address: cosmetics, abi: cosmeticsAbi, functionName: "equipped", args: [addr, 1] }) as Promise<bigint>,
  ]);
  return { owned: ITEMS.filter((_, i) => bals[i] > 0n).map((i) => i.id), equipped: [Number(e0), Number(e1)] };
}

/** Owned + equipped -> what to draw. An equipped item wins its category; other categories use the best owned item; all owned effects play. */
export function lookFrom(o: Owned): Look {
  const look: Look = { ...DEFAULT_LOOK, fx: [] };
  const owned = new Set(o.owned);
  for (const cat of Object.keys(CAT_KEY)) {
    const best = ITEMS.filter((i) => i.category === cat && owned.has(i.id)).sort((a, b) => RANK[b.rarity] - RANK[a.rarity])[0];
    if (best) (look as any)[CAT_KEY[cat]] = best.id;
  }
  for (const id of o.equipped) {
    const it = ITEMS.find((i) => i.id === id);
    if (it && owned.has(id) && CAT_KEY[it.category]) (look as any)[CAT_KEY[it.category]] = id;
  }
  look.fx = ITEMS.filter((i) => i.category === "effect" && owned.has(i.id)).map((i) => i.id);
  return look;
}

export const cosmeticsCall = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi: cosmeticsAbi as any, functionName, args } as any);

export function findItem(q: unknown): Item | undefined {
  const s = String(q ?? "").trim().toLowerCase();
  if (/^\d+$/.test(s)) return ITEMS.find((i) => i.id === Number(s));
  return ITEMS.find((i) => i.name.toLowerCase() === s) ?? ITEMS.find((i) => i.name.toLowerCase().includes(s));
}
