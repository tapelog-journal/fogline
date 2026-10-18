// The TapeLog house bot: a singleton Durable Object that joins matches created against it and plays
// them with the baseline bot from agent/src/bot.ts, driven by Durable Object alarms. Testnet only.
import { DurableObject } from "cloudflare:workers";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decide } from "../../agent/src/bot";
import { commitments, randomLayout, type Layout } from "../../agent/src/layout";
import { Phase, PIECES } from "../../agent/src/rules";
import { gameCall, pub, readState, sendTx, tokenCall } from "./chain";
import { cfg, MAX_HOUSE_MATCHES, type Env } from "./env";
import { nonceStore } from "./store";

interface HouseMatch { session?: string; layout?: Layout; added: number; log: string[]; minBlock?: string }

export class House extends DurableObject<Env> {
  get address(): Address { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address; }

  async getAddress() { return this.address; }

  private async all(): Promise<Record<string, HouseMatch>> { return (await this.ctx.storage.get("matches")) ?? {}; }
  private async save(m: Record<string, HouseMatch>) { await this.ctx.storage.put("matches", m); }

  async activeCount() { return Object.keys(await this.all()).length; }

  /** Register a match the house should play (called by the Player DO right after createMatch). */
  async watch(id: string, session?: string): Promise<{ ok: boolean; reason?: string }> {
    const m = await this.all();
    if (!m[id]) {
      if (Object.keys(m).length >= MAX_HOUSE_MATCHES) return { ok: false, reason: "the house bot is busy with too many matches; try again later" };
      m[id] = { session, added: Date.now(), log: [] };
      await this.save(m);
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

  private cur?: HouseMatch;
  private async tx(fn: string, data: Hex, to?: Address) {
    const c = cfg(this.env);
    const r = await sendTx({ rpc: c.rpcUrl, key: this.env.HOUSE_KEY as Hex, to: to ?? c.game, data, fn, nonces: nonceStore(this.ctx.storage), attempts: 2 });
    if (this.cur) this.cur.minBlock = r.receipt.blockNumber.toString();
    return r;
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
      try { await this.env.FUNDER.get(this.env.FUNDER.idFromName("funder")).fundHouse(this.address); } catch (e) { console.log("fundHouse failed", String(e)); }
    }
    let next = Infinity;
    for (const id of ids) {
      try {
        const r = await this.step(id, m[id]);
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
    this.cur = hm;
    const s = await readState(c.rpcUrl, c.game, id, hm.minBlock ? BigInt(hm.minBlock) : undefined);
    const mm = s.match;
    if (mm.phase === Phase.None) return { nextMs: 3000, remove: Date.now() - hm.added > 120_000 };
    if (mm.phase === Phase.Settled) return { nextMs: 0, remove: true };
    if (mm.phase === Phase.Open) {
      const p1 = mm.players[1].toLowerCase();
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
    const action = decide(s, side, hm.layout, now);
    switch (action.kind) {
      case "commit": {
        const l = hm.layout ?? randomLayout(side);
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
        return { nextMs: Math.max(2000, Math.min((left + 6) * 1000, 3_600_000)) };
      }
      default: return { nextMs: 0, remove: true };
    }
  }
}

export { PIECES };
