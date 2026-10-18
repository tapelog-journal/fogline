// Public Elo ladder. One Durable Object ("ladder"). Results are never taken from clients: the ladder reads
// each match's outcome from the chain itself, so a rating only moves for a match that settled onchain.
// Names are optional handles the player chose; the client kind is whatever the client reported about itself.
// Game for entertainment. Testnet only. Not investment advice.
import { DurableObject } from "cloudflare:workers";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { foglineAbi, pub } from "./chain";
import { cfg, renderer, type Env } from "./env";
import { elo, START_RATING } from "./elo";
export { elo, START_RATING };

// counted end reasons: BeaconCaptured 1, Resigned 2, Timeout 3, DrawMaxPly 4, IllegalReveal 7, WinnerUnverified 8
// not counted: None 0, DrawNoCommit 5, Cancelled 6 (no game was played)
const COUNTED = new Set([1, 2, 3, 4, 7, 8]);
const SETTLED = 6, NONE = 0;
const SCHEMA = 3; // 3: house bot rated per difficulty
export const CLIENTS = ["browser", "mcp", "skill", "api", "house", "unknown"] as const;

export interface Entry { address: string; name?: string; client: string; rating: number; games: number; w: number; l: number; d: number; last?: number; peak?: number }

export class Ladder extends DurableObject<Env> {
  private houseAddr() { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase(); }
  private async entry(addr: string): Promise<Entry> {
    const a = addr.toLowerCase();
    const e = await this.ctx.storage.get<Entry>(`p:${a}`);
    if (e) return e;
    const lv = /^house:(easy|normal|hard)$/.exec(a)?.[1];
    if (lv) return { address: a, client: "house", name: `TapeLog bot (${lv[0].toUpperCase() + lv.slice(1)})`, rating: START_RATING, games: 0, w: 0, l: 0, d: 0 };
    return { address: a, client: "unknown", rating: START_RATING, games: 0, w: 0, l: 0, d: 0 };
  }
  /** The house bot is rated separately per difficulty: its seat in a match maps to house:<level>. */
  private async seat(addr: string, id: string) {
    if (addr.toLowerCase() !== this.houseAddr()) return addr;
    return `house:${(await this.ctx.storage.get<string>(`hl:${id}`)) ?? "normal"}`;
  }
  async noteHouseLevel(id: string, level: string) { await this.migrate(); await this.ctx.storage.put(`hl:${id}`, level); }

  /** A player set a handle and/or reported its client kind. */
  async register(address: string, name?: string, client?: string) {
    await this.migrate();
    if (address.toLowerCase() === this.houseAddr()) return undefined;
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
    if (phase !== SETTLED) { await this.track(id, 15_000); return { rated: false, reason: "not settled yet" }; }
    if (!COUNTED.has(reason)) { await this.ctx.storage.put(`m:${id}`, { skipped: reason }); await this.untrack(id); return { rated: false, reason: "not a played game" }; }
    const [a, b] = [await this.entry(await this.seat(m.players[0], id)), await this.entry(await this.seat(m.players[1], id))];
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
    // pre-build the winning-moment highlight clip so share links preview instantly
    if (winner < 2) this.ctx.waitUntil(renderer(this.env, id).clip(id, "win").catch(() => undefined));
    return { rated: true };
  }
  private async track(id: string, soon = 60_000) { const s = new Set((await this.ctx.storage.get<string[]>("open")) ?? []); if (!s.has(id)) { s.add(id); await this.ctx.storage.put("open", [...s].slice(-200)); } await this.arm(soon); }
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
    const v = (await this.ctx.storage.get<number>("schema")) ?? 0;
    if (v === SCHEMA) return;
    // keep players' chosen names, client tags and the house difficulty notes; recompute every rating from the chain
    const keep = new Map<string, unknown>();
    for (const [k, e] of await this.ctx.storage.list<Entry>({ prefix: "p:" })) if (e.client !== "house" && (e.name || e.client !== "unknown")) keep.set(k, { address: e.address, name: e.name, client: e.client, rating: START_RATING, games: 0, w: 0, l: 0, d: 0 });
    for (const [k, l] of await this.ctx.storage.list({ prefix: "hl:" })) keep.set(k, l);
    await this.ctx.storage.deleteAll();
    for (const [k, val] of keep) await this.ctx.storage.put(k, val);
    await this.ctx.storage.put("schema", SCHEMA);
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
  /** Highest match id the scanner has seen. */
  async latest() { await this.migrate(); return ((await this.ctx.storage.get<number>("scan")) ?? 2) - 1; }
}
