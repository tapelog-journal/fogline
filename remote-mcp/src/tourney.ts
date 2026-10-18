// Weekly Fogline tournaments: one Durable Object ("tourney") that schedules a single-elimination bracket every
// week, takes sign-ups, creates each pairing's onchain match, keeps matches moving (reveals, settles, expired
// timers), advances winners from onchain results and hands out prizes. Prizes are valueless test fUSD and
// decorative cosmetics only: never real money. Game for entertainment. Testnet only.
import { DurableObject } from "cloudflare:workers";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Phase } from "../../agent/src/rules";
import { readState } from "./chain";
import { ITEMS } from "./cosmetics";
import { cfg, ladder, watchLink, type Env } from "./env";
import { adjudicate, advance, displayName, newWeekly, recordResult, startBracket, type Entrant, type Pairing, type Tourney as T } from "./tourney-core";

const TICK_RUNNING = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Tourney extends DurableObject<Env> {
  private houseAddr() { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase(); }
  private async index() { return (await this.ctx.storage.get<string[]>("index")) ?? []; }
  private async load(id: string) { return this.ctx.storage.get<T>(`t:${id}`); }
  private async save(t: T) {
    const idx = await this.index();
    if (!idx.includes(t.id)) { idx.push(t.id); await this.ctx.storage.put("index", idx.slice(-200)); }
    await this.ctx.storage.put(`t:${t.id}`, t);
  }
  private player(objectId: string) { return this.env.PLAYER.get(this.env.PLAYER.idFromString(objectId)) as any; }
  private house() { return this.env.HOUSE.get(this.env.HOUSE.idFromName("house")) as any; }

  /** Make sure this week's tournament exists (auto-scheduling). */
  private async ensureWeekly(now = Date.now()): Promise<T> {
    for (const id of (await this.index()).slice().reverse()) {
      const t = await this.load(id);
      if (t?.kind === "weekly" && (t.status === "signup" || t.status === "running")) return t;
    }
    const n = ((await this.ctx.storage.get<number>("weeklyCount")) ?? 0) + 1;
    let t = newWeekly(now, n);
    while (await this.load(t.id)) t = { ...t, id: t.id + "b" }; // a week whose tournament already finished early
    await this.ctx.storage.put("weeklyCount", n);
    await this.save(t);
    await this.arm(Math.min(t.startsAt - now, 600_000));
    return t;
  }
  private async arm(ms: number) { const cur = await this.ctx.storage.getAlarm(); const at = Date.now() + Math.max(1000, ms); if (!cur || cur > at) await this.ctx.storage.setAlarm(at); }

  async overview(id?: string) {
    const cur = await this.ensureWeekly();
    const t = id ? await this.load(id) : cur;
    const all = await Promise.all((await this.index()).slice(-12).reverse().map((i) => this.load(i)));
    return { tournament: t, list: all.filter(Boolean).map((x) => ({ id: x!.id, name: x!.name, kind: x!.kind, status: x!.status, startsAt: x!.startsAt, entrants: x!.entrants.filter((e) => !e.bot).length, champion: x!.champion !== undefined ? displayName(x!.entrants[x!.champion]) : undefined })) };
  }

  async signup(who: { address: string; objectId: string; name?: string; client: string }, id?: string) {
    const t = id ? await this.load(id) : await this.ensureWeekly();
    if (!t) throw new Error("no such tournament");
    if (t.status !== "signup") throw new Error(`sign-ups for ${t.name} are closed (${t.status})`);
    if (Date.now() >= t.startsAt) throw new Error("sign-ups just closed: the bracket is starting");
    const a = who.address.toLowerCase();
    const have = t.entrants.find((e) => e.address === a);
    if (have) { have.name = who.name ?? have.name; have.client = who.client; await this.save(t); return { tournament: t, already: true }; }
    if (t.entrants.length >= t.maxHumans) throw new Error(`${t.name} is full (${t.maxHumans} players)`);
    let rating = 1200;
    try { rating = (await (ladder(this.env) as any).get(a)).rating; } catch {}
    t.entrants.push({ address: a, objectId: who.objectId, name: who.name, client: who.client, rating, joinedAt: Date.now() });
    await this.save(t);
    await this.arm(Math.min(t.startsAt - Date.now(), 600_000));
    return { tournament: t, already: false };
  }

  async withdraw(address: string, id?: string) {
    const t = id ? await this.load(id) : await this.ensureWeekly();
    if (!t || t.status !== "signup") throw new Error("you can only withdraw before the bracket starts");
    const before = t.entrants.length;
    t.entrants = t.entrants.filter((e) => e.address !== address.toLowerCase());
    await this.save(t);
    return { removed: before !== t.entrants.length };
  }

  /** Operator-only (admin token checked by the Worker): a short practice bracket, used to test the machinery. */
  async createPractice(spec: { name?: string; startsInSec?: number; turnTimeout?: number; fillBots?: boolean; maxHumans?: number }) {
    const now = Date.now();
    const t: T = { ...newWeekly(now, 0), id: `practice-${now.toString(36)}`, name: spec.name ?? "Fogline practice cup", kind: "practice",
      startsAt: now + 1000 * Math.max(30, spec.startsInSec ?? 120), turnTimeout: Math.max(60, spec.turnTimeout ?? 120), fillBots: !!spec.fillBots, maxHumans: Math.min(16, spec.maxHumans ?? 8), roundCapMs: 3600_000 };
    await this.save(t);
    await this.arm(t.startsAt - now);
    return t;
  }

  async alarm() {
    const t0 = Date.now();
    await this.ensureWeekly();
    let next = 3600_000;
    for (const id of (await this.index()).slice(-20)) {
      let t = await this.load(id);
      if (!t || t.status === "done" || t.status === "cancelled") {
        if (t?.status === "done" && t.champion !== undefined && !t.prizeTxs) { await this.payPrizes(t); }
        continue;
      }
      try {
        if (t.status === "signup") {
          if (Date.now() < t.startsAt) { next = Math.min(next, t.startsAt - Date.now()); continue; }
          // refresh ratings for seeding, then close sign-ups
          for (const e of t.entrants) { try { e.rating = (await (ladder(this.env) as any).get(e.address)).rating; } catch {} }
          t = startBracket(t, Date.now());
          await this.save(t);
        }
        if (t.status === "running") { t = await this.drive(t, t0); await this.save(t); next = Math.min(next, TICK_RUNNING); }
        if (t.status === "done") { await this.payPrizes(t); }
      } catch (e: any) { console.log(`tourney ${id} tick failed:`, String(e?.message ?? e).slice(0, 300)); next = Math.min(next, 30_000); }
    }
    await this.ctx.storage.setAlarm(Date.now() + Math.max(2000, next));
  }

  private async drive(t: T, t0: number): Promise<T> {
    const c = cfg(this.env), r = t.rounds.length - 1;
    for (let i = 0; i < t.rounds[r].length; i++) {
      if (Date.now() - t0 > 22_000) break; // keep each alarm short; the rest happens next tick
      const p = t.rounds[r][i];
      if (p.status === "done" || p.a === null || p.b === null) continue;
      const A = t.entrants[p.a], B = t.entrants[p.b];
      if (p.status === "waiting") { t = await this.createMatch(t, r, i, A, B); continue; }
      // playing: follow the onchain match
      const s = await readState(c.rpcUrl, c.game, BigInt(p.matchId!));
      const m = s.match, nowS = Math.floor(Date.now() / 1000);
      const aSide = m.players[0].toLowerCase() === this.addrOf(A) ? 0 : 1, flip = aSide === 1; // which chain side the bracket's "a" sits on
      const seatOf = (side: number) => (side === aSide ? A : B);
      if (m.phase === Phase.Settled) {
        const w = Number(m.winner), reason = Number(m.reason);
        const note = reason === 5 ? "nobody placed an army: the better seed advances" : reason === 6 ? "match cancelled: the better seed advances" : undefined;
        t = recordResult(t, r, i, w === 2 ? 2 : flip ? 1 - w : w, Date.now(), note);
        continue;
      }
      if (m.phase === Phase.Open) { const g = A.bot ? A : B; if (!g.bot && g.objectId && g !== (A.bot ? B : A)) await this.player(g.objectId).join(p.matchId).catch(() => {}); continue; }
      if (m.phase === Phase.PendingReveal) { const d = seatOf(m.turn); if (d.objectId) await this.player(d.objectId).autoReveal(p.matchId).catch(() => {}); }
      if (m.phase === Phase.Ended) {
        const w = seatOf(Number(m.winner));
        if (w.objectId && !m.verified[Number(m.winner)]) await this.player(w.objectId).autoSettle(p.matchId).catch(() => {});
        if (nowS > Number(m.deadline) + 5) await this.house().claim(p.matchId, "claimUnverified").catch((e: any) => console.log("claimUnverified", String(e).slice(0, 120)));
        continue;
      }
      if ((m.phase === Phase.Committing || m.phase === Phase.Playing || m.phase === Phase.PendingReveal) && nowS > Number(m.deadline) + 5) {
        await this.house().claim(p.matchId, "claimTimeout").catch((e: any) => console.log("claimTimeout", String(e).slice(0, 120)));
        continue;
      }
      if (p.startedAt && Date.now() - p.startedAt > t.roundCapMs) {
        const alive: [number, number] = [0, 0];
        s.pieces.forEach((pc, pid) => { if (pc.alive) alive[pid < 16 ? 0 : 1]++; });
        const w = adjudicate(alive);
        t = recordResult(t, r, i, w === 2 ? 2 : flip ? 1 - w : w, Date.now(), `round time cap: ${w === 2 ? "equal pieces, the better seed advances" : "more pieces left on the board"}`);
      }
    }
    return t;
  }
  private addrOf(e: Entrant) { return e.bot ? this.houseAddr() : e.address; }

  private async createMatch(t: T, r: number, i: number, A: Entrant, B: Entrant): Promise<T> {
    const p = t.rounds[r][i] as Pairing & { tries?: number };
    const ref = `t-${t.id}-r${r}-m${i}`.slice(0, 64);
    // the human seat creates the match (vs the house bot, or reserved for the other human), the other human joins
    const [host, guest] = A.bot ? [B, A] : [A, B];
    try {
      if (guest.bot) {
        const res = await this.player(host.objectId!).playBot("0", t.turnTimeout, ref, guest.bot);
        p.matchId = res.matchId;
      } else {
        const res = await this.player(host.objectId!).create("0", guest.address, t.turnTimeout, ref);
        p.matchId = res.matchId;
        await this.player(guest.objectId!).join(res.matchId);
      }
      p.status = "playing"; p.startedAt = Date.now(); p.error = undefined;
    } catch (e: any) {
      p.tries = (p.tries ?? 0) + 1; p.error = String(e?.message ?? e).slice(0, 160);
      console.log(`tourney ${t.id} r${r} m${i} create failed (${p.tries}):`, p.error);
      if (p.matchId && !p.startedAt) { p.status = "playing"; p.startedAt = Date.now(); } // created but the join failed: the guest can still join
      else if (p.tries >= 4) {
        // could not even create the match (e.g. the host is out of testnet gas): the host forfeits
        const hostIsA = host === A;
        t = recordResult(t, r, i, hostIsA ? 1 : 0, Date.now(), "the match could not be created for the host: the opponent advances");
      }
    }
    await sleep(200);
    return t;
  }

  private async payPrizes(t: T) {
    if (t.prizeTxs) return;
    t.prizeTxs = [];
    for (const pr of t.prizes) {
      const idx = pr.place === 1 ? t.champion : t.runnerUp;
      const e = idx === undefined ? undefined : t.entrants[idx];
      if (!e || e.bot) { t.prizeTxs.push({ place: pr.place, to: e ? "house" : "-", txs: [], error: e?.bot ? "won by a TapeLog bot: no prize" : "no player" }); continue; }
      try {
        const price = ITEMS.find((x) => x.id === pr.item)?.price ?? 0;
        const txs = await this.house().givePrize(e.address as Address, pr.item, price, pr.fusd);
        t.prizeTxs.push({ place: pr.place, to: e.address, txs });
      } catch (err: any) { t.prizeTxs.push({ place: pr.place, to: e.address, txs: [], error: String(err?.message ?? err).slice(0, 160) }); }
    }
    await this.save(t);
  }

  async kick() { await this.arm(1000); }
}

/** Public JSON view of a tournament (no object ids). */
export function publicView(t: T, env: Env, you?: string) {
  const name = (i: number | null | undefined) => (i === null || i === undefined ? null : displayName(t.entrants[i]));
  const me = you?.toLowerCase();
  const youIdx = me ? t.entrants.findIndex((e) => e.address === me) : -1;
  const ROUND_NAMES = (n: number, k: number) => (n - k === 1 ? "Final" : n - k === 2 ? "Semifinals" : n - k === 3 ? "Quarterfinals" : `Round ${k + 1}`);
  const totalRounds = t.rounds.length ? Math.log2(t.rounds[0].length * 2) : 0;
  let yourMatch: any;
  const rounds = t.rounds.map((round, k) => ({
    name: ROUND_NAMES(totalRounds, k),
    matches: round.map((p) => {
      const o = { a: name(p.a), b: name(p.b), aSeed: p.a === null ? null : p.a + 1, bSeed: p.b === null ? null : p.b + 1, aClient: p.a === null ? null : t.entrants[p.a].client, bClient: p.b === null ? null : t.entrants[p.b].client,
        status: p.status, matchId: p.matchId ?? null, watch: p.matchId ? watchLink(env, p.matchId) : null, winner: name(p.winner), note: p.note ?? null, error: p.status === "waiting" ? p.error ?? null : null };
      if (youIdx >= 0 && (p.a === youIdx || p.b === youIdx) && p.status !== "done") yourMatch = { ...o, round: k + 1 };
      return o;
    }),
  }));
  return {
    id: t.id, name: t.name, kind: t.kind, status: t.status, startsAt: new Date(t.startsAt).toISOString(), startsAtMs: t.startsAt, turnTimeoutSeconds: t.turnTimeout,
    entrants: t.entrants.map((e, i) => ({ seed: t.status === "signup" ? null : i + 1, name: displayName(e), client: e.client, rating: e.bot ? null : e.rating, bot: e.bot ?? null })),
    signedUp: t.entrants.filter((e) => !e.bot).length, maxPlayers: t.maxHumans,
    rounds, prizes: t.prizes.map((p) => ({ place: p.place, cosmetic: p.itemName, testFusd: p.fusd })),
    champion: name(t.champion), runnerUp: name(t.runnerUp), prizeTxs: (t.prizeTxs ?? []).map((x) => ({ place: x.place, txs: x.txs.map((h) => `https://sepolia.basescan.org/tx/${h}`), note: x.error ?? null })),
    you: me ? { signedUp: youIdx >= 0, seed: youIdx >= 0 && t.status !== "signup" ? youIdx + 1 : null, eliminated: youIdx >= 0 && t.status !== "signup" && !yourMatch && t.champion !== youIdx, match: yourMatch ?? null } : undefined,
    note: t.note ?? null,
  };
}
export { advance };
