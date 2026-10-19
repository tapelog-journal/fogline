// Singleton faucet/funder for player and house wallets. Valueless Base Sepolia ETH only.
// Rate-limited per session, per (hashed) IP and globally per UTC day, with a balance floor so it can't be drained.
import { DurableObject } from "cloudflare:workers";
import { formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pub, sendTx } from "./chain";
import { cfg, FUNDING, type Env } from "./env";
import { Mutex, nonceStore, sha256Hex, utcDay } from "./store";

export interface GrantResult { ok: boolean; hash?: Hex; amountEth?: string; reason?: string }

export class Funder extends DurableObject<Env> {
  private lock = new Mutex();
  private async counter(k: string) { return (await this.ctx.storage.get<number>(k)) ?? 0; }
  private async bump(k: string) { await this.ctx.storage.put(k, (await this.counter(k)) + 1); }

  private async send(to: Address, value: bigint, fn: string): Promise<Hex> {
    const c = cfg(this.env);
    const tx = await this.lock.run(() => sendTx({ rpc: c.rpcUrl, key: this.env.FUNDER_KEY as Hex, to, value, fn, nonces: nonceStore(this.ctx.storage) }));
    return tx.hash;
  }
  private async funderBalance() {
    return pub(cfg(this.env).rpcUrl).getBalance({ address: privateKeyToAccount(this.env.FUNDER_KEY as Hex).address });
  }

  /** One-time grant for a brand-new player session. */
  async grant(session: string, address: Address, ip: string): Promise<GrantResult> { return this.gate.run(() => this._grant(session, address, ip)); }
  private gate = new Mutex();
  private async _grant(session: string, address: Address, ip: string): Promise<GrantResult> {
    const day = utcDay();
    if (await this.ctx.storage.get(`granted:${session}`)) return { ok: false, reason: "this session was already funded" };
    const ipKey = `ip:${day}:${await sha256Hex(this.env.IP_SALT + ip)}`;
    if ((await this.counter(ipKey)) >= FUNDING.maxGrantsPerIpPerDay) return { ok: false, reason: "daily funding limit for your network reached; try tomorrow" };
    if ((await this.counter(`grants:${day}`)) >= FUNDING.maxGrantsPerDay) return { ok: false, reason: "global daily funding limit reached; try tomorrow" };
    if ((await this.funderBalance()) < FUNDING.funderFloorWei + FUNDING.grantWei) return { ok: false, reason: "faucet is empty for now" };
    await this.ctx.storage.put(`granted:${session}`, true);
    await this.bump(ipKey);
    await this.bump(`grants:${day}`);
    let hash: Hex;
    try { hash = await this.send(address, FUNDING.grantWei, "grant"); }
    catch (e) { await this.ctx.storage.delete(`granted:${session}`); throw e; }
    return { ok: true, hash, amountEth: formatEther(FUNDING.grantWei) };
  }

  /** Small top-up when a funded session runs low on gas. */
  async topUp(session: string, address: Address): Promise<GrantResult> { return this.gate.run(() => this._topUp(session, address)); }
  private async _topUp(session: string, address: Address): Promise<GrantResult> {
    const day = utcDay();
    if (!(await this.ctx.storage.get(`granted:${session}`))) return { ok: false, reason: "unknown session" };
    const bal = await pub(cfg(this.env).rpcUrl).getBalance({ address });
    if (bal >= FUNDING.topUpBelowWei) return { ok: false, reason: `balance ${formatEther(bal)} ETH is still enough` };
    const sk = `topups:${day}:${session}`;
    if ((await this.counter(sk)) >= FUNDING.maxTopUpsPerSessionPerDay) return { ok: false, reason: "top-up limit for this session reached today" };
    if ((await this.counter(`topups:${day}`)) >= FUNDING.maxTopUpsPerDay) return { ok: false, reason: "global daily top-up limit reached" };
    if ((await this.funderBalance()) < FUNDING.funderFloorWei + FUNDING.topUpWei) return { ok: false, reason: "faucet is empty for now" };
    await this.bump(sk); await this.bump(`topups:${day}`);
    const hash = await this.send(address, FUNDING.topUpWei, "topUp");
    return { ok: true, hash, amountEth: formatEther(FUNDING.topUpWei) };
  }

  /** Keep the house bot's gas topped up (internal only). */
  async fundHouse(address: Address): Promise<GrantResult> { return this.gate.run(() => this._fundHouse(address)); }
  private async _fundHouse(address: Address): Promise<GrantResult> {
    const bal = await pub(cfg(this.env).rpcUrl).getBalance({ address });
    if (bal >= FUNDING.houseMinWei) return { ok: false, reason: "house has enough" };
    const hash = await this.send(address, FUNDING.houseTopUpWei, "fundHouse");
    return { ok: true, hash, amountEth: formatEther(FUNDING.houseTopUpWei) };
  }

  /** Small, capped gas for exhibition bot personas (internal only; stops well above the player-grant floor). */
  async fundBot(address: Address): Promise<GrantResult> { return this.gate.run(() => this._fundBot(address)); }
  private async _fundBot(address: Address): Promise<GrantResult> {
    const bal = await pub(cfg(this.env).rpcUrl).getBalance({ address });
    if (bal >= FUNDING.botMinWei) return { ok: false, reason: "bot has enough" };
    const day = utcDay();
    if ((await this.counter(`bots:${day}`)) >= FUNDING.maxBotTopUpsPerDay) return { ok: false, reason: "daily exhibition gas budget used" };
    if ((await this.funderBalance()) < FUNDING.exhibitionFloorWei) return { ok: false, reason: "funder below the exhibition floor" };
    await this.bump(`bots:${day}`);
    const hash = await this.send(address, FUNDING.botTopUpWei, "fundBot");
    return { ok: true, hash, amountEth: formatEther(FUNDING.botTopUpWei) };
  }

  async stats() {
    const day = utcDay();
    return { day, grantsToday: await this.counter(`grants:${day}`), topUpsToday: await this.counter(`topups:${day}`), botTopUpsToday: await this.counter(`bots:${day}`), funderBalanceEth: formatEther(await this.funderBalance()) };
  }
}
