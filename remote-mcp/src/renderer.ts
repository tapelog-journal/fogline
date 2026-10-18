// Renders board pictures. Receives fog-of-war-filtered scenes only (hidden ranks are already null),
// adds public data (equipped cosmetics, last onchain move), and caches PNGs by content hash.
import { DurableObject } from "cloudflare:workers";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lastActions } from "./chain";
import { lookFrom, ownedBy } from "./cosmetics";
import { cfg, type Env } from "./env";
import { boardSvg, envSvg, tableOf, type BoardScene, type Look } from "./render";
import { b64, svgToPng } from "./png";
import { sha256Hex } from "./store";

export interface RenderReq { scene: BoardScene; players: [string, string]; block: string }
const MAX_CACHED = 400;
const RENDER_VERSION = "r2|"; // bump when the drawing changes

export class Renderer extends DurableObject<Env> {
  private looks = new Map<string, { at: number; look: Look }>();
  private envs = new Map<number, string>();

  private async lookOf(addr: string): Promise<Look> {
    const k = addr.toLowerCase(), hit = this.looks.get(k);
    if (hit && Date.now() - hit.at < 60_000) return hit.look;
    const c = cfg(this.env);
    try {
      const look = lookFrom(await ownedBy(c.rpcUrl, c.cosmetics, addr as Address));
      this.looks.set(k, { at: Date.now(), look });
      return look;
    } catch (e) { console.log("looks failed", String(e).slice(0, 160)); return hit?.look ?? { skin: 0, table: 0, fog: 0, trail: 0, banner: 0, fx: [] }; }
  }

  private async envImage(table: number) {
    let u = this.envs.get(table);
    if (!u) {
      const stored = await this.ctx.storage.get<Uint8Array>(`env:${table}:v1`);
      const png = stored ?? (await svgToPng(envSvg(table)));
      if (!stored) await this.ctx.storage.put(`env:${table}:v1`, png);
      u = "data:image/png;base64," + b64(png);
      this.envs.set(table, u);
    }
    return u;
  }

  /** Returns the PNG and a content hash (stable for identical pictures). */
  async png(req: RenderReq): Promise<{ png: Uint8Array; hash: string; cached: boolean }> {
    const c = cfg(this.env), sc = req.scene;
    const [l0, l1, last] = await Promise.all([
      req.players[0] && !/^0x0{40}$/i.test(req.players[0]) ? this.lookOf(req.players[0]) : undefined,
      req.players[1] && !/^0x0{40}$/i.test(req.players[1]) ? this.lookOf(req.players[1]) : undefined,
      sc.ply > 0 ? lastActions(c.rpcUrl, c.game, BigInt(sc.matchId), BigInt(req.block)) : [],
    ]);
    if (l0) sc.looks[0] = l0;
    if (l1) sc.looks[1] = l1;
    if (last.length) sc.last = last[last.length - 1];
    if (last.length > 1) sc.prev = last[0];
    const house = privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase();
    sc.names = req.players.map((a) => (!a || /^0x0{40}$/i.test(a) ? "" : a.toLowerCase() === house ? "TapeLog bot" : `${a.slice(0, 6)}…${a.slice(-4)}`)) as [string, string];
    // the picture is a pure function of the scene, so cache by a hash of the scene itself
    const hash = (await sha256Hex(RENDER_VERSION + JSON.stringify(sc))).slice(0, 32);
    const key = `png:${hash}`;
    const hit = await this.ctx.storage.get<Uint8Array>(key);
    if (hit) return { png: hit, hash, cached: true };
    const png = await svgToPng(boardSvg(sc, { envImage: await this.envImage(tableOf(sc)) }));
    const index = ((await this.ctx.storage.get<string[]>("index")) ?? []).filter((k) => k !== key);
    index.push(key);
    const drop = index.length > MAX_CACHED ? index.splice(0, index.length - MAX_CACHED) : [];
    await this.ctx.storage.put({ [key]: png, index });
    if (drop.length) await this.ctx.storage.delete(drop);
    return { png, hash, cached: false };
  }
}
