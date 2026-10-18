// Public Elo ladder. One Durable Object ("ladder"). Results are never taken from clients: the ladder reads
// each match's outcome from the chain itself, so a rating only moves for a match that settled onchain.
// Names are optional handles the player chose; the client kind is whatever the client reported about itself.
// Game for entertainment. Testnet only. Not investment advice.
import { DurableObject } from "cloudflare:workers";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { foglineAbi, pub } from "./chain";
import { cfg, type Env } from "./env";
import { elo, START_RATING } from "./elo";
export { elo, START_RATING };

// counted end reasons: BeaconCaptured 1, Resigned 2, Timeout 3, DrawMaxPly 4, IllegalReveal 7, WinnerUnverified 8
// not counted: None 0, DrawNoCommit 5, Cancelled 6 (no game was played)
const COUNTED = new Set([1, 2, 3, 4, 7, 8]);
const SETTLED = 6, NONE = 0;
export const CLIENTS = ["browser", "mcp", "skill", "api", "house", "unknown"] as const;

export interface Entry { address: string; name?: string; client: string; rating: number; games: number; w: number; l: number; d: number; last?: number; peak?: number }

export class Ladder extends DurableObject<Env> {
  private houseAddr() { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase(); }
  private async entry(addr: string): Promise<Entry> {
    const a = addr.toLowerCase();
    const e = await this.ctx.storage.get<Entry>(`p:${a}`);
    if (e) return e;
    const house = a === this.houseAddr();
    return { address: a, client: house ? "house" : "unknown", name: house ? "TapeLog bot" : undefined, rating: START_RATING, games: 0, w: 0, l: 0, d: 0 };
  }

  /** A player set a handle and/or reported its client kind. */
  async register(address: string, name?: string, client?: string) {
    await this.migrate();
    const e = await this.entry(address);
    if (e.client === "house") return e;
    if (name !== undefined) e.name = name || undefined;
    if (client && client !== "api") e.client = client; else if (client && e.client === "unknown") e.client = client;
    await this.ctx.storage.put(`p:${e.address}`, e);
    return e;
  }

  /** Check one match onchain and rate it once if it settled. Safe to call any number of times. */
  async check(id: string): Promise<{ rated: boolean; reason?: string }> {
    await this.migrate();
    if (await this.ctx.storage.get(`m:${id}`)) return { rated: false, reason: "already rated" };
    const c = cfg(this.env);
    const m: any = await pub(c.rpcUrl).readContract({ address: c.game, abi: foglineAbi, functionName: "getMatch", args: [BigInt(id)] });
    const phase = Number(m.phase), reason = Number(m.reason), winner = Number(m.winner);
    if (phase === NONE) return { rated: false, reason: "no such match" };
    if (phase !== SETTLED) { await this.track(id); return { rated: false, reason: "not settled yet" }; }
    if (!COUNTED.has(reason)) { await this.ctx.storage.put(`m:${id}`, { skipped: reason }); await this.untrack(id); return { rated: false, reason: "not a played game" }; }
    const [a, b] = [await this.entry(m.players[0]), await this.entry(m.players[1])];
    if (a.address === b.address) { await this.ctx.storage.put(`m:${id}`, { skipped: "self" }); await this.untrack(id); return { rated: false, reason: "self-play" }; }
    const score = winner === 0 ? 1 : winner === 1 ? 0 : 0.5;
    const [ra, rb] = elo(a.rating, b.rating, score, a.games, b.games);
    // when the match actually ended ≈ the last action's deadline minus the turn timer (not when we noticed it)
    const now = Math.min(Date.now(), (Number(m.deadline) - Number(m.turnTimeout)) * 1000) || Date.now();
    for (const [e, r, s] of [[a, ra, score], [b, rb, 1 - score]] as [Entry, number, number][]) {
      e.rating = r; e.games++; e.last = now; e.peak = Math.max(e.peak ?? START_RATING, r);
      if (s === 1) e.w++; else if (s === 0) e.l++; else e.d++;
    }
    await this.ctx.storage.put({ [`p:${a.address}`]: a, [`p:${b.address}`]: b, [`m:${id}`]: { at: now, winner, reason } });
    await this.untrack(id);
    const recent = ((await this.ctx.storage.get<any[]>("recent")) ?? []).slice(-29);
    recent.push({ id, at: now, players: [a.address, b.address], winner, reason, ratings: [ra, rb] });
    await this.ctx.storage.put("recent", recent);
    return { rated: true };
  }
  private async track(id: string) { const s = new Set((await this.ctx.storage.get<string[]>("open")) ?? []); if (!s.has(id)) { s.add(id); await this.ctx.storage.put("open", [...s].slice(-200)); } await this.arm(); }
  private async untrack(id: string) { const s = (await this.ctx.storage.get<string[]>("open")) ?? []; if (s.includes(id)) await this.ctx.storage.put("open", s.filter((x) => x !== id)); }
  private async arm(ms = 60_000) { const cur = await this.ctx.storage.getAlarm(); if (!cur || cur > Date.now() + ms) await this.ctx.storage.setAlarm(Date.now() + ms); }

  /** Scan new match ids in order (and re-check unsettled ones) so every settled match gets rated. */
  async alarm() {
    await this.migrate();
    let next = (await this.ctx.storage.get<number>("scan")) ?? 1, misses = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000 && misses < 2) {
      const r = await this.check(String(next)).catch((e) => ({ rated: false, reason: "error " + String(e).slice(0, 80) }));
      if (r.reason === "no such match") { misses++; break; }
      if (r.reason?.startsWith("error")) break;
      next++; await this.ctx.storage.put("scan", next);
    }
    for (const id of ((await this.ctx.storage.get<string[]>("open")) ?? []).slice(0, 25)) { if (Date.now() - t0 > 25_000) break; await this.check(id).catch(() => {}); }
    const open = (await this.ctx.storage.get<string[]>("open")) ?? [];
    await this.ctx.storage.setAlarm(Date.now() + (open.length ? 120_000 : 600_000));
  }
  async kick() { await this.arm(1000); }

  /** One-time rebuild when the stored format changes (ratings are recomputed from the chain). */
  private async migrate() {
    if ((await this.ctx.storage.get<number>("schema")) === 2) return;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("schema", 2);
    await this.ctx.storage.setAlarm(Date.now() + 500);
  }
  async top(limit = 50) {
    await this.migrate();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 500);
    const all = [...(await this.ctx.storage.list<Entry>({ prefix: "p:" })).values()].filter((e) => e.games > 0);
    all.sort((x, y) => y.rating - x.rating || y.games - x.games);
    return { players: all.slice(0, limit), total: all.length, scanned: ((await this.ctx.storage.get<number>("scan")) ?? 1) - 1, recent: ((await this.ctx.storage.get<any[]>("recent")) ?? []).slice(-10).reverse() };
  }
  async get(address: string) { return this.entry(address); }
}
