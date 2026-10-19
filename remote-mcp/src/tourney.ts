// Fogline tournaments: one Durable Object ("tourney") that schedules an 8-player Fogline Cup every 4 hours
// (UTC-aligned) plus the 16-player Sunday Major, takes sign-ups (closing 5 minutes before the start), creates each pairing's onchain match, keeps matches moving (reveals, settles, expired
// timers), advances winners from onchain results and hands out prizes. Prizes are valueless test fUSD and
// decorative cosmetics only: never real money. Game for entertainment. Testnet only.
import { DurableObject } from "cloudflare:workers";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Phase } from "../../agent/src/rules";
import { readState } from "./chain";
import { ITEMS } from "./cosmetics";
import { cfg, ladder, renderer, watchLink, type Env } from "./env";
import { pub } from "./chain";
import { newWeekly } from "./tourney-core";
import { adjudicate, advance, asMajor, displayName, isExhibitionSlot, newCup, newMajor, recordResult, signupClosesAt, startBracket, type BotLevel, type Entrant, type Pairing, type Tourney as T } from "./tourney-core";
import type { Persona } from "./house";
import { FUNDING } from "./env";

/** Exhibition bot personas: distinct names, levels and (unlimited-supply) cosmetics so bot-only cups are watchable. */
export const PERSONAS: Persona[] = [
  { slug: "rewind", name: "Rewind", level: "hard", items: [5, 9, 13] },
  { slug: "overdub", name: "Overdub", level: "hard", items: [7, 11, 17] },
  { slug: "splice", name: "Splice", level: "normal", items: [1, 3, 19] },
  { slug: "reel", name: "Reel", level: "normal", items: [5, 4, 15] },
  { slug: "static", name: "Static", level: "normal", items: [7, 9, 20] },
  { slug: "hiss", name: "Hiss", level: "easy", items: [1, 11, 14] },
  { slug: "wobble", name: "Wobble", level: "easy", items: [5, 3, 18] },
  { slug: "leader", name: "Leader", level: "easy", items: [7, 4, 13] },
];
const LV = (l: string) => l[0].toUpperCase() + l.slice(1);
export const personaName = (p: Persona) => `${p.name} · TapeLog bot (${LV(p.level)})`;

const TICK_RUNNING = 20_000;
const ORIGIN = "https://fogline-mcp.tapelog.workers.dev";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Tourney extends DurableObject<Env> {
  private houseAddr() { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase(); }
  private async index() { return (await this.ctx.storage.get<string[]>("index")) ?? []; }
  private async load(id: string) { return this.ctx.storage.get<T>(`t:${id}`); }
  private async save(t: T) {
    const idx = await this.index();
    if (!idx.includes(t.id)) { idx.push(t.id); await this.ctx.storage.put("index", idx.slice(-200)); }
    await this.ctx.storage.put(`t:${t.id}`, t);
    const live = t.status === "signup" || t.status === "running" || (t.status === "done" && !t.prizeTxs);
    const act = (await this.ctx.storage.get<string[]>("active")) ?? idx.slice(-20);
    const has = act.includes(t.id);
    if (live && !has) await this.ctx.storage.put("active", [...act, t.id]);
    else if (!live && has) await this.ctx.storage.put("active", act.filter((x) => x !== t.id));
    else if (!(await this.ctx.storage.get("active"))) await this.ctx.storage.put("active", act);
  }
  private async active() { return (await this.ctx.storage.get<string[]>("active")) ?? (await this.index()).slice(-20); }
  private player(objectId: string) { return this.env.PLAYER.get(this.env.PLAYER.idFromString(objectId)) as any; }
  private house() { return this.env.HOUSE.get(this.env.HOUSE.idFromName("house")) as any; }
  private bot(slug: string) { return this.env.HOUSE.get(this.env.HOUSE.idFromName(`bot:${slug}`)) as any; }

  /** Auto-scheduling: there is always a Sunday Major and a Fogline Cup taking sign-ups. Returns the next cup. */
  private async ensureSchedule(now = Date.now()): Promise<T> {
    let major: T | undefined, cup: T | undefined;
    for (const id of (await this.active()).slice().reverse()) {
      let t = await this.load(id);
      if (!t || !(t.status === "signup" || t.status === "running")) continue;
      if (t.kind === "weekly" && t.status === "signup") { t = asMajor(t); await this.save(t); }
      if ((t.kind === "major" || t.kind === "weekly") && !major) major = t;
      if (t.kind === "cup" && t.status === "signup" && now < signupClosesAt(t) && (!cup || t.startsAt < cup.startsAt)) cup = t;
    }
    if (!major) {
      const n = ((await this.ctx.storage.get<number>("weeklyCount")) ?? 0) + 1;
      let t = newMajor(now, n);
      while (await this.load(t.id)) t = { ...t, id: t.id + "b" };
      await this.ctx.storage.put("weeklyCount", n);
      await this.save(t);
    }
    if (!cup) {
      const n = ((await this.ctx.storage.get<number>("cupCount")) ?? 0) + 1;
      cup = newCup(now, n);
      if (await this.load(cup.id)) cup = (await this.load(cup.id))!;
      else { await this.ctx.storage.put("cupCount", n); await this.save(cup); }
    }
    await this.arm(Math.max(5000, Math.min(signupClosesAt(cup) - now - 60_000, 600_000)));
    return cup;
  }
  private async ensureWeekly(now = Date.now()) { return this.ensureSchedule(now); }
  private async arm(ms: number) { const cur = await this.ctx.storage.getAlarm(); const at = Date.now() + Math.max(1000, ms); if (!cur || cur > at) await this.ctx.storage.setAlarm(at); }

  async overview(id?: string) {
    const next = await this.ensureSchedule();
    const ids = [...new Set([...(await this.index()).slice(-30), ...(await this.active())])].reverse();
    const all = (await Promise.all(ids.map((i) => this.load(i)))).filter(Boolean).sort((x, y) => y!.startsAt - x!.startsAt) as T[];
    const current = all.filter((x) => x.status === "running");
    const major = all.find((x) => (x.kind === "major" || x.kind === "weekly") && (x.status === "signup" || x.status === "running"));
    const recent = all.filter((x) => x.status === "done" && x.kind !== "practice").slice(0, 12);
    const fresh = recent.find((x) => x.endedAt && Date.now() - x.endedAt < 3 * 3600_000);
    const t = id ? await this.load(id) : current[0] ?? fresh ?? next;
    const brief = (x: T) => ({ id: x.id, name: x.name, kind: x.kind, exhibition: !!x.exhibition, status: x.status, startsAt: x.startsAt, entrants: x.entrants.filter((e) => !e.bot).length, champion: x.champion !== undefined ? displayName(x.entrants[x.champion]) : undefined, finalMatchId: x.finalMatchId ?? null });
    return {
      tournament: t, next, current, major, recent,
      list: [...current, next, ...(major && major.status === "signup" ? [major] : []), ...recent, ...(id && t && ![...current, ...recent].some((x) => x.id === id) ? [t] : [])].filter(Boolean).map((x) => brief(x!)),
      skippedRecently: all.filter((x) => x.status === "skipped").length,
    };
  }

  private async resolve(id?: string): Promise<T | undefined> {
    const next = await this.ensureSchedule();
    if (!id || id === "next" || id === "cup") return next;
    if (id === "major" || id === "weekly") return (await this.overview()).major ?? undefined;
    return this.load(id);
  }
  async signup(who: { address: string; objectId: string; name?: string; client: string }, id?: string) {
    const t = await this.resolve(id);
    if (!t) throw new Error("no such tournament");
    if (t.status !== "signup") throw new Error(`sign-ups for ${t.name} are closed (${t.status})`);
    if (Date.now() >= signupClosesAt(t)) throw new Error(`sign-ups for ${t.name} closed 5 minutes before the start; join the next cup instead (id "next")`);
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
    let t = await this.resolve(id);
    if (!id && t && !t.entrants.some((e) => e.address === address.toLowerCase())) {
      // no id: withdraw from whichever open tournament this player entered
      for (const i of await this.active()) { const x = await this.load(i); if (x?.status === "signup" && x.entrants.some((e) => e.address === address.toLowerCase())) { t = x; break; } }
    }
    if (!t || t.status !== "signup") throw new Error("you can only withdraw before the bracket starts");
    const before = t.entrants.length;
    t.entrants = t.entrants.filter((e) => e.address !== address.toLowerCase());
    await this.save(t);
    return { removed: before !== t.entrants.length };
  }

  /** Operator-only (admin token checked by the Worker): a short practice bracket, used to test the machinery. */
  async createPractice(spec: { name?: string; startsInSec?: number; turnTimeout?: number; fillBots?: boolean; maxHumans?: number; exhibitionCup?: boolean }) {
    const now = Date.now();
    if (spec.exhibitionCup) {
      // operator: an extra cup right now; if nobody joins it becomes a bot exhibition (used for the launch run)
      const startsAt = now + 1000 * Math.max(60, spec.startsInSec ?? 120);
      const t: T = { ...newCup(now, 0, startsAt), id: `cup-x-${now.toString(36)}`, name: spec.name ?? "Fogline Launch Cup", signupCloseMs: 30_000 };
      (t as any).forceExhibition = true;
      await this.save(t);
      await this.arm(startsAt - now);
      return t;
    }
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
    for (const id of await this.active()) {
      let t = await this.load(id);
      if (!t || t.status === "done" || t.status === "cancelled" || t.status === "skipped") {
        if (t?.status === "done" && t.champion !== undefined && !t.prizeTxs) { await this.finish(t); await this.payPrizes(t); }
        continue;
      }
      try {
        if (t.status === "signup") {
          const humans = t.entrants.filter((e) => !e.bot).length;
          // an empty cup in an exhibition slot: get the bot personas ready while sign-ups close
          if (!humans && Date.now() >= signupClosesAt(t) && Date.now() < t.startsAt && t.kind !== "practice") { await this.preparePersonas().catch((e) => console.log("personas:", String(e).slice(0, 160))); }
          if (Date.now() < t.startsAt) { next = Math.min(next, Date.now() < signupClosesAt(t) ? signupClosesAt(t) - Date.now() : t.startsAt - Date.now()); continue; }
          // refresh ratings for seeding, then close sign-ups
          for (const e of t.entrants) { try { e.rating = (await (ladder(this.env) as any).get(e.address)).rating; } catch {} }
          let opts: { personas?: Entrant[]; skipNote?: string } = {};
          if (!humans && t.kind !== "practice") opts = await this.exhibitionPlan(t);
          t = startBracket(t, Date.now(), opts);
          await this.save(t);
          if (t.status === "skipped") console.log(`tourney ${t.id} skipped: ${t.note}`);
        }
        if (t.status === "running") { t = await this.drive(t, t0); await this.save(t); next = Math.min(next, TICK_RUNNING); }
        if (t.status === "done") { await this.finish(t); await this.payPrizes(t); }
      } catch (e: any) { console.log(`tourney ${id} tick failed:`, String(e?.message ?? e).slice(0, 300)); next = Math.min(next, 30_000); }
    }
    // prune finished tournaments from the active list
    const act = await this.active(), keep: string[] = [];
    for (const id of act) { const t = await this.load(id); if (t && (t.status === "signup" || t.status === "running" || (t.status === "done" && !t.prizeTxs))) keep.push(id); }
    if (keep.length !== act.length || !(await this.ctx.storage.get("active"))) await this.ctx.storage.put("active", keep);
    await this.ctx.storage.setAlarm(Date.now() + Math.max(2000, next));
  }

  /** Exhibition plan for an empty cup: only in exhibition slots and only while the funder has gas to spare. */
  private async exhibitionPlan(t: T): Promise<{ personas?: Entrant[]; skipNote?: string }> {
    if (t.kind === "cup" && !isExhibitionSlot(t.startsAt) && !(t as any).forceExhibition) return { skipNote: "no sign-ups (no exhibition in this slot)" };
    const c = cfg(this.env);
    const funder = await pub(c.rpcUrl).getBalance({ address: privateKeyToAccount(this.env.FUNDER_KEY as Hex).address });
    if (funder < FUNDING.exhibitionFloorWei) return { skipNote: "no sign-ups (exhibition paused: testnet gas budget low)" };
    const ready = await this.preparePersonas();
    if (ready.length < 4) return { skipNote: "no sign-ups (exhibition bots not ready)" };
    return { personas: ready.sort(() => Math.random() - 0.5) };
  }
  /** Set up every persona (idempotent) and register them with the ladder as unrated exhibition bots. */
  private async preparePersonas(): Promise<Entrant[]> {
    const res = await Promise.all(PERSONAS.map(async (p) => { try { return { p, r: await this.bot(p.slug).initPersona(p) }; } catch (e: any) { console.log(`persona ${p.slug}:`, String(e?.message ?? e).slice(0, 160)); return { p, r: undefined }; } }));
    const ok = res.filter((x) => x.r?.ready);
    await (ladder(this.env) as any).noteExhibitionBots(res.filter((x) => x.r).map((x) => ({ address: x.r!.address, name: personaName(x.p) })));
    return ok.map((x, i) => ({ address: x.r!.address, name: personaName(x.p), client: "house", rating: 0, bot: x.p.level as BotLevel, persona: x.p.slug, joinedAt: i }));
  }
  /** Bracket finished: remember the final and pre-build its win clip (share card). */
  private async finish(t: T) {
    const f = t.rounds[t.rounds.length - 1]?.[0];
    if (f?.matchId && !t.finalMatchId) { t.finalMatchId = f.matchId; await this.save(t); }
    if (t.finalMatchId && !(t as any).clipDone) {
      try { await (renderer(this.env, t.finalMatchId) as any).clip(t.finalMatchId, "win"); (t as any).clipDone = true; await this.save(t); } catch (e) { console.log("final clip:", String(e).slice(0, 120)); }
    }
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
      if (A.persona && B.persona) {
        // exhibition: the personas play by themselves; stop long games at the move/time cap (the side behind resigns)
        const pp = p as Pairing & { capped?: number };
        const live = m.phase === Phase.Playing || m.phase === Phase.PendingReveal;
        const over = (t.maxPlies && Number(m.ply) >= t.maxPlies) || (p.startedAt && Date.now() - p.startedAt > t.roundCapMs);
        if (live && over && (!pp.capped || Date.now() - pp.capped > 60_000)) {
          const alive: [number, number] = [0, 0];
          s.pieces.forEach((pc, pid) => { if (pc.alive) alive[pid < 16 ? 0 : 1]++; });
          let w = adjudicate(alive);
          if (w === 2) w = aSide === 0 ? 0 : 1; // equal: the better seed (bracket "a") wins
          const loser = seatOf(1 - w);
          pp.capped = Date.now(); p.note = `move cap (${t.maxPlies} plies): ${alive[w]} pieces vs ${alive[1 - w]}, the side behind resigned`;
          await this.bot(loser.persona!).resignMatch(p.matchId!).catch((e: any) => console.log("cap resign", String(e).slice(0, 120)));
          continue;
        }
        if (m.phase === Phase.Open) { const g = m.players[1].toLowerCase() === A.address ? A : B, h = g === A ? B : A; await this.bot(g.persona!).watch(p.matchId, undefined, g.bot, h.persona).catch(() => {}); continue; }
        if ((m.phase === Phase.Committing || live || m.phase === Phase.Ended) && nowS > Number(m.deadline) + 5) {
          await this.house().claim(p.matchId, m.phase === Phase.Ended ? "claimUnverified" : "claimTimeout").catch((e: any) => console.log("exh claim", String(e).slice(0, 120)));
        }
        continue;
      }
      if (m.phase === Phase.Open) { const g = A.bot ? A : B; if (!g.bot && g.objectId && g !== (A.bot ? B : A)) await this.player(g.objectId).join(p.matchId).catch((e: any) => console.log(`tourney join retry #${p.matchId}:`, String(e?.message ?? e).slice(0, 160))); continue; }
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
  private addrOf(e: Entrant) { return e.bot && !e.persona ? this.houseAddr() : e.address; }

  private async createMatch(t: T, r: number, i: number, A: Entrant, B: Entrant): Promise<T> {
    const p = t.rounds[r][i] as Pairing & { tries?: number };
    const ref = `t-${t.id}-r${r}-m${i}`.slice(0, 64);
    // the human seat creates the match (vs the house bot, or reserved for the other human), the other human joins
    const [host, guest] = A.bot && !(A.persona && B.persona) ? [B, A] : [A, B];
    try {
      if (host.persona && guest.persona) {
        if (!p.matchId) p.matchId = await this.bot(host.persona).createVs(guest.address as Address, guest.persona, t.turnTimeout, host.bot);
        const w = await this.bot(guest.persona).watch(p.matchId, undefined, guest.bot, host.persona);
        if (!w.ok) throw new Error(w.reason);
      } else if (guest.bot) {
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
      if (t.exhibition) { t.prizeTxs.push({ place: pr.place, to: "-", txs: [], error: "exhibition: no prizes" }); continue; }
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
    id: t.id, name: t.name, kind: t.kind, exhibition: !!t.exhibition, rated: !t.exhibition, status: t.status, startsAt: new Date(t.startsAt).toISOString(), startsAtMs: t.startsAt,
    signupClosesAt: new Date(signupClosesAt(t)).toISOString(), signupClosesAtMs: signupClosesAt(t), turnTimeoutSeconds: t.turnTimeout, roundCapMinutes: Math.round(t.roundCapMs / 60_000), maxPlies: t.maxPlies ?? null,
    finalMatchId: t.finalMatchId ?? null, finalClip: t.finalMatchId ? `${ORIGIN}/clip/${t.finalMatchId}/win` : null, finalCard: t.finalMatchId ? `${ORIGIN}/clip/${t.finalMatchId}/win/card.png` : null,
    entrants: t.entrants.map((e, i) => ({ seed: t.status === "signup" ? null : i + 1, name: displayName(e), client: e.client, rating: e.bot ? null : e.rating, bot: e.bot ?? null, persona: e.persona ?? null })),
    signedUp: t.entrants.filter((e) => !e.bot).length, maxPlayers: t.maxHumans,
    rounds, prizes: t.prizes.map((p) => ({ place: p.place, cosmetic: p.itemName || null, testFusd: p.fusd })),
    champion: name(t.champion), runnerUp: name(t.runnerUp), prizeTxs: (t.prizeTxs ?? []).map((x) => ({ place: x.place, txs: x.txs.map((h) => `https://sepolia.basescan.org/tx/${h}`), note: x.error ?? null })),
    you: me ? { signedUp: youIdx >= 0, seed: youIdx >= 0 && t.status !== "signup" ? youIdx + 1 : null, eliminated: youIdx >= 0 && t.status !== "signup" && !yourMatch && t.champion !== youIdx, match: yourMatch ?? null } : undefined,
    note: t.note ?? null,
  };
}
export { advance };

/** Schedule view for the API / MCP / page: the next cup, what is running now, the Sunday Major and recent results with win clips. */
export function scheduleView(o: any, env: Env, you?: string) {
  const v = (t: T | undefined) => (t ? publicView(t, env, you) : null);
  return {
    schedule: "Fogline Cups every 4 hours at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC (8 players, sign-ups close 5 minutes before); Sunday Major every Sunday 18:00 UTC (16 players). Empty cups become bot exhibitions (not rated, no prizes; paused if testnet gas runs low).",
    next: v(o.next), current: (o.current ?? []).map((t: T) => v(t)), major: v(o.major),
    recent: (o.recent ?? []).map((t: T) => ({ id: t.id, name: t.name, kind: t.kind, exhibition: !!t.exhibition, startsAt: new Date(t.startsAt).toISOString(), endedAt: t.endedAt ? new Date(t.endedAt).toISOString() : null,
      champion: t.champion !== undefined ? displayName(t.entrants[t.champion]) : null, runnerUp: t.runnerUp !== undefined ? displayName(t.entrants[t.runnerUp]) : null, players: t.entrants.filter((e) => !e.bot).length,
      finalMatchId: t.finalMatchId ?? null, clip: t.finalMatchId ? `${ORIGIN}/clip/${t.finalMatchId}/win` : null, card: t.finalMatchId ? `${ORIGIN}/clip/${t.finalMatchId}/win/card.png` : null })),
  };
}
