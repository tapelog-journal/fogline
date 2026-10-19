// The TapeLog house bot: a singleton Durable Object that joins matches created against it and plays
// them with the baseline bot from agent/src/bot.ts, driven by Durable Object alarms. Testnet only.
import { DurableObject } from "cloudflare:workers";
import { zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decideLevel, layoutFor, type Level } from "../../agent/src/levels";
import { commitments, type Layout } from "../../agent/src/layout";
import { Phase, PIECES } from "../../agent/src/rules";
import { gameCall, matchIdFrom, pub, readState, sendTx, tokenCall } from "./chain";
import { cfg, ladder, MAX_HOUSE_MATCHES, type Env } from "./env";
import { Mutex, nonceStore } from "./store";
import { cosmeticsCall } from "./cosmetics";

interface HouseMatch { session?: string; level?: Level; layout?: Layout; added: number; log: string[]; minBlock?: string; opp?: string }
/** An exhibition bot persona: a House instance with its own throwaway testnet key (never returned), fixed level and cosmetics. */
export interface Persona { slug: string; name: string; level: Level; items: number[] }

export class House extends DurableObject<Env> {
  // the main house bot ("house") signs with HOUSE_KEY; exhibition personas ("bot:<slug>") with their own stored key
  private botKey?: Hex;
  private persona?: Persona;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.botKey = await ctx.storage.get<Hex>("botKey"); this.persona = await ctx.storage.get<Persona>("persona"); });
  }
  private get key(): Hex { return this.botKey ?? (this.env.HOUSE_KEY as Hex); }
  get address(): Address { return privateKeyToAccount(this.key).address; }

  /** Set up an exhibition persona (idempotent): key, a little testnet gas from the funder, fUSD and its cosmetics. */
  async initPersona(p: Persona): Promise<{ address: string; ready: boolean; note?: string }> {
    if (!this.botKey) { const k = generatePrivateKey(); await this.ctx.storage.put("botKey", k); this.botKey = k; }
    if (!this.persona || this.persona.name !== p.name) { await this.ctx.storage.put("persona", p); this.persona = p; }
    const c = cfg(this.env), pc = pub(c.rpcUrl), me = this.address;
    const f = await this.env.FUNDER.get(this.env.FUNDER.idFromName("funder")).fundBot(me);
    if ((await pc.getBalance({ address: me })) === 0n) return { address: me.toLowerCase(), ready: false, note: f.reason };
    const done = new Set((await this.ctx.storage.get<number[]>("itemsDone")) ?? []);
    const todo = p.items.filter((i) => !done.has(i));
    if (todo.length) {
      const { mockUsdcAbi } = await import("./chain");
      const { ITEMS } = await import("./cosmetics");
      const cost = todo.reduce((a, i) => a + (ITEMS.find((x) => x.id === i)?.price ?? 0), 0);
      try {
        const bal = (await pc.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [me] })) as bigint;
        if (bal < BigInt(cost) * 1_000_000n) await this.tx("faucet", tokenCall("faucet", []), c.token);
        await this.tx("approve", tokenCall("approve", [c.cosmetics, BigInt(cost) * 1_000_000n]), c.token);
        for (const i of todo) { await this.tx("buy", cosmeticsCall("buy", [BigInt(i), 1]), c.cosmetics); done.add(i); await this.ctx.storage.put("itemsDone", [...done]); }
      } catch (e: any) { console.log(`persona ${p.slug} cosmetics:`, String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)); }
    }
    return { address: me.toLowerCase(), ready: true };
  }
  /** Exhibition: create a match reserved for another persona and play it. */
  async createVs(opponent: Address, oppSlug: string, turnTimeout: number, level: Level): Promise<string> {
    const r = await this.tx("createMatch", gameCall("createMatch", [zeroAddress, 0n, turnTimeout, opponent]));
    const id = matchIdFrom(r.receipt).toString();
    await this.watch(id, undefined, level, oppSlug);
    return id;
  }
  /** Exhibition move cap reached and this persona is behind: resign so the result is decided onchain. */
  async resignMatch(id: string) {
    const s = await readState(cfg(this.env).rpcUrl, cfg(this.env).game, BigInt(id));
    if (s.match.phase !== Phase.Playing && s.match.phase !== Phase.PendingReveal) return undefined;
    const r = await this.tx("resign", gameCall("resign", [BigInt(id)]));
    const m = await this.all(); const opp = m[id]?.opp;
    if (opp) await this.kickOpp(opp, id, r.receipt.blockNumber.toString());
    return r.hash;
  }
  private async kickOpp(slug: string, id: string, block?: string) { try { await (this.env.HOUSE.get(this.env.HOUSE.idFromName(`bot:${slug}`)) as any).kick(id, block); } catch (e) { console.log("kick opp failed", String(e).slice(0, 100)); } }

  async getAddress() { return this.address; }

  private async all(): Promise<Record<string, HouseMatch>> { return (await this.ctx.storage.get("matches")) ?? {}; }
  private async save(m: Record<string, HouseMatch>) { await this.ctx.storage.put("matches", m); }

  async activeCount() { return Object.keys(await this.all()).length; }

  /** Register a match the house should play (called by the Player DO right after createMatch). */
  async watch(id: string, session?: string, level: Level = "normal", opp?: string): Promise<{ ok: boolean; reason?: string }> {
    const m = await this.all();
    if (!m[id]) {
      if (Object.keys(m).length >= MAX_HOUSE_MATCHES) return { ok: false, reason: "the house bot is busy with too many matches; try again later" };
      m[id] = { session, level, added: Date.now(), log: [], opp };
      await this.save(m);
      if (!this.persona) { try { await ladder(this.env).noteHouseLevel(id, level); } catch (e) { console.log("ladder level note failed", String(e).slice(0, 120)); } }
    }
    await this.ctx.storage.setAlarm(Date.now() + 200);
    return { ok: true };
  }

  /** Nudge the bot: something happened in match `id` (a player moved). */
  async kick(id: string, minBlock?: string) {
    const m = await this.all();
    if (!m[id]) return;
    if (minBlock && (!m[id].minBlock || BigInt(minBlock) > BigInt(m[id].minBlock!))) { m[id].minBlock = minBlock; await this.save(m); }
    this.kickedAt = Date.now();
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }
  private kickedAt = 0;

  async recentLog(id: string) { return (await this.all())[id]?.log ?? []; }
  async levelOf(id: string): Promise<Level | undefined> { return (await this.all())[id]?.level; }

  private cur?: HouseMatch;
  private curId?: string;
  private lastTx?: { id: string; block: string };
  private txLock = new Mutex();
  private async tx(fn: string, data: Hex, to?: Address) {
    const c = cfg(this.env);
    const r = await this.txLock.run(() => sendTx({ rpc: c.rpcUrl, key: this.key, to: to ?? c.game, data, fn, nonces: nonceStore(this.ctx.storage), attempts: 2 }));
    if (this.cur) { this.cur.minBlock = r.receipt.blockNumber.toString(); this.lastTx = { id: this.curId!, block: this.cur.minBlock }; }
    return r;
  }

  /** Tournament housekeeping: anyone may claim an expired timer onchain; the house pays the (testnet) gas. */
  async claim(id: string, fn: "claimTimeout" | "claimUnverified") {
    const r = await this.tx(fn, gameCall(fn, [BigInt(id)]));
    return r.hash;
  }

  /** Tournament prize: one decorative cosmetic (bought with valueless test fUSD, then transferred) plus test fUSD. Never real money. */
  async givePrize(to: Address, itemId: number, itemPrice: number, fusd: number): Promise<string[]> {
    const c = cfg(this.env), p = pub(c.rpcUrl), me = this.address, out: string[] = [];
    const { mockUsdcAbi } = await import("./chain");
    const need = BigInt(itemPrice + fusd) * 1_000_000n;
    const bal = (await p.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [me] })) as bigint;
    if (bal < need) out.push((await this.tx("faucet", tokenCall("faucet", []), c.token)).hash);
    if (itemId) {
      const allow = (await p.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "allowance", args: [me, c.cosmetics] })) as bigint;
      if (allow < BigInt(itemPrice) * 1_000_000n) out.push((await this.tx("approve", tokenCall("approve", [c.cosmetics, BigInt(itemPrice) * 50_000_000n]), c.token)).hash);
      out.push((await this.tx("buy", cosmeticsCall("buy", [BigInt(itemId), 1]), c.cosmetics)).hash);
      out.push((await this.tx("safeTransferFrom", cosmeticsCall("safeTransferFrom", [me, to, BigInt(itemId), 1n, "0x"]), c.cosmetics)).hash);
    }
    if (fusd > 0) out.push((await this.tx("transfer", tokenCall("transfer", [to, BigInt(fusd) * 1_000_000n]), c.token)).hash);
    return out;
  }

  async alarm() {
    const started = Date.now();
    const m = await this.all();
    const ids = Object.keys(m);
    if (!ids.length) return;
    // keep the house bot's gas topped up (checked at most every 10 minutes)
    const last = (await this.ctx.storage.get<number>("fundCheck")) ?? 0;
    if (Date.now() - last > 600_000) {
      await this.ctx.storage.put("fundCheck", Date.now());
      const f = this.env.FUNDER.get(this.env.FUNDER.idFromName("funder"));
      try { if (this.persona) await f.fundBot(this.address); else await f.fundHouse(this.address); } catch (e) { console.log("fund failed", String(e)); }
    }
    let next = Infinity;
    for (const id of ids) {
      try {
        this.lastTx = undefined;
        const r = await this.step(id, m[id]);
        const lt = this.lastTx as { id: string; block: string } | undefined;
        if (lt && m[id].opp) await this.kickOpp(m[id].opp!, id, lt.block); // exhibition: wake the other bot
        if (r.remove) delete m[id]; else next = Math.min(next, r.nextMs);
      } catch (e: any) {
        console.log(`house step ${id} failed:`, String(e?.shortMessage ?? e?.message ?? e).slice(0, 300));
        next = Math.min(next, 4000);
      }
      if (m[id] && m[id].log.length > 20) m[id].log = m[id].log.slice(-20);
    }
    // merge: a kick may have raised minBlock while we were working
    const fresh = await this.all();
    for (const id of Object.keys(m)) if (fresh[id]?.minBlock && (!m[id].minBlock || BigInt(fresh[id].minBlock!) > BigInt(m[id].minBlock!))) m[id].minBlock = fresh[id].minBlock;
    for (const id of Object.keys(fresh)) if (!m[id] && !ids.includes(id)) m[id] = fresh[id]; // watched during this run
    await this.save(m);
    if (this.kickedAt >= started || Object.keys(m).some((id) => !ids.includes(id))) next = Math.min(next, 300); // kicked mid-run: look again right away
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Date.now() + next);
  }

  private async step(idStr: string, hm: HouseMatch): Promise<{ nextMs: number; remove?: boolean }> {
    const c = cfg(this.env), id = BigInt(idStr), me = this.address.toLowerCase();
    this.cur = hm; this.curId = idStr;
    const s = await readState(c.rpcUrl, c.game, id, hm.minBlock ? BigInt(hm.minBlock) : undefined);
    const mm = s.match;
    if (mm.phase === Phase.None) return { nextMs: 3000, remove: Date.now() - hm.added > 120_000 };
    if (mm.phase === Phase.Settled) { try { await ladder(this.env).check(idStr); } catch (e) { console.log("ladder check failed", String(e).slice(0, 120)); } return { nextMs: 0, remove: true }; }
    if (mm.phase === Phase.Open) {
      const p1 = mm.players[1].toLowerCase();
      if (mm.players[0].toLowerCase() === me && hm.opp) return { nextMs: 3000, remove: Date.now() - hm.added > 900_000 }; // exhibition: our reserved opponent joins
      if (mm.players[0].toLowerCase() === me || (p1 !== me && p1 !== "0x0000000000000000000000000000000000000000")) return { nextMs: 0, remove: true };
      if (mm.stake > 0n) {
        if (mm.token.toLowerCase() !== c.token.toLowerCase()) return { nextMs: 0, remove: true }; // only our test token
        const bal = (await pub(c.rpcUrl).readContract({ address: c.token, abi: (await import("./chain")).mockUsdcAbi, functionName: "balanceOf", args: [this.address] })) as bigint;
        if (bal < mm.stake) await this.tx("faucet", tokenCall("faucet", []), c.token);
        await this.tx("approve", tokenCall("approve", [c.game, mm.stake]), c.token);
      }
      const r = await this.tx("joinMatch", gameCall("joinMatch", [id]));
      hm.log.push(`house joined (${r.hash})`);
      return { nextMs: 500 };
    }
    const side = mm.players[0].toLowerCase() === me ? 0 : mm.players[1].toLowerCase() === me ? 1 : -1;
    if (side < 0) return { nextMs: 0, remove: true };
    const now = BigInt(Math.floor(Date.now() / 1000) - 4); // a little behind wall clock to avoid early timeout claims
    const level = hm.level ?? "normal";
    const action = decideLevel(s, side, hm.layout, now, level);
    switch (action.kind) {
      case "commit": {
        const l = hm.layout ?? layoutFor(level, side);
        hm.layout = l;
        await this.save({ ...(await this.all()), [idStr]: hm }); // persist salts BEFORE committing
        const r = await this.tx("commitLayout", gameCall("commitLayout", [id, commitments(id, this.address, l)]));
        hm.log.push(`house committed its hidden army (${r.hash})`);
        return { nextMs: 1000 };
      }
      case "move": {
        const mv = action.move, l = hm.layout!;
        const r = await this.tx("move", gameCall("move", [id, mv.from, mv.to, l.ranks[mv.pieceIndex], l.salts[mv.pieceIndex]]));
        hm.log.push(`house ${mv.attack ? "attacked" : "moved"} ${mv.from}->${mv.to} (${r.hash})`);
        return { nextMs: 1500 };
      }
      case "reveal": {
        const i = action.pieceIndex, l = hm.layout!;
        const r = await this.tx("revealDefense", gameCall("revealDefense", [id, l.ranks[i], l.salts[i]]));
        hm.log.push(`house revealed its defender (${r.hash})`);
        return { nextMs: 1500 };
      }
      case "verify": {
        const l = hm.layout!;
        const r = await this.tx("verifyLayout", gameCall("verifyLayout", [id, l.ranks, l.salts]));
        hm.log.push(`house verified its army and settled (${r.hash})`);
        try { await ladder(this.env).check(idStr); } catch (e) { console.log("ladder check failed", String(e).slice(0, 120)); }
        return { nextMs: 0, remove: true };
      }
      case "claimTimeout": {
        const r = await this.tx("claimTimeout", gameCall("claimTimeout", [id]));
        hm.log.push(`house claimed a timeout (${r.hash})`);
        return { nextMs: 2000 };
      }
      case "claimUnverified": {
        const r = await this.tx("claimUnverified", gameCall("claimUnverified", [id]));
        hm.log.push(`house claimed: winner never verified (${r.hash})`);
        return { nextMs: 2000 };
      }
      case "wait": {
        // The player won: ask the player's session to verify its army so the result settles.
        if (mm.phase === Phase.Ended && mm.winner !== side && mm.winner < 2 && hm.session) {
          try { await this.env.PLAYER.get(this.env.PLAYER.idFromName(hm.session)).autoSettle(idStr); } catch (e) { console.log("autoSettle failed", String(e)); }
          return { nextMs: 5000 };
        }
        // Our attack is waiting for the player's defender reveal: the player's session does it automatically.
        if (mm.phase === Phase.PendingReveal && mm.turn !== side && hm.session) {
          try { await this.env.PLAYER.get(this.env.PLAYER.idFromName(hm.session)).autoReveal(idStr); } catch (e) { console.log("autoReveal failed", String(e)); }
          return { nextMs: 3000 };
        }
        // Waiting on the human: wake up at their deadline to claim a timeout (the Player DO kicks us on every move).
        const left = Number(mm.deadline) - Math.floor(Date.now() / 1000);
        return { nextMs: Math.max(2000, Math.min((left + 6) * 1000, hm.opp ? 12_000 : 3_600_000)) };
      }
      default: return { nextMs: 0, remove: true };
    }
  }
}

export { PIECES };
