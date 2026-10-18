// Renders board pictures. Receives fog-of-war-filtered scenes only (hidden ranks are already null),
// adds public data (equipped cosmetics, last onchain move), and caches PNGs by content hash.
import { DurableObject } from "cloudflare:workers";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lastActions } from "./chain";
import { lookFrom, ownedBy } from "./cosmetics";
import { cfg, type Env } from "./env";
import { boardSvg, envSvg, tableOf, type BoardScene, type Look } from "./render";
import { b64, svgToPng, svgToRgba } from "./png";
import { actionOf, cardSvg, clipSteps, encodeGif, findHighlights, type Highlight } from "./clips";
import { sceneFrom } from "./render";
import { sha256Hex } from "./store";
import { GAME_DEPLOY_BLOCK, head, loadHistory, scanCreated, type History } from "./history";

export interface RenderReq { scene: BoardScene; players: [string, string]; block: string; width?: number; /** shop previews: keep scene.looks / scene.last as given */ fixedLooks?: boolean }
const MAX_CACHED = 400;
const RENDER_VERSION = "r4|"; // bump when the drawing changes

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
    const fixed = !!req.fixedLooks;
    const [l0, l1, last] = await Promise.all([
      !fixed && req.players[0] && !/^0x0{40}$/i.test(req.players[0]) ? this.lookOf(req.players[0]) : undefined,
      !fixed && req.players[1] && !/^0x0{40}$/i.test(req.players[1]) ? this.lookOf(req.players[1]) : undefined,
      sc.ply > 0 && !(fixed && sc.last) ? lastActions(c.rpcUrl, c.game, BigInt(sc.matchId), BigInt(req.block)) : [],
    ]);
    if (l0) sc.looks[0] = l0;
    if (l1) sc.looks[1] = l1;
    if (last.length) sc.last = last[last.length - 1];
    if (last.length > 1) sc.prev = last[0];
    const house = privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase();
    sc.names = req.players.map((a) => (!a || /^0x0{40}$/i.test(a) ? "" : a.toLowerCase() === house ? "TapeLog bot" : `${a.slice(0, 6)}…${a.slice(-4)}`)) as [string, string];
    // the picture is a pure function of the scene, so cache by a hash of the scene itself
    const hash = (await sha256Hex(RENDER_VERSION + (req.width ?? "") + (fixed ? "fixed|" : "") + JSON.stringify(sc))).slice(0, 32);
    const key = `png:${hash}`;
    const hit = await this.ctx.storage.get<Uint8Array>(key);
    if (hit) return { png: hit, hash, cached: true };
    const png = await svgToPng(boardSvg(sc, { envImage: await this.envImage(tableOf(sc)) }), req.width);
    const index = ((await this.ctx.storage.get<string[]>("index")) ?? []).filter((k) => k !== key);
    index.push(key);
    const drop = index.length > MAX_CACHED ? index.splice(0, index.length - MAX_CACHED) : [];
    await this.ctx.storage.put({ [key]: png, index });
    if (drop.length) await this.ctx.storage.delete(drop);
    return { png, hash, cached: false };
  }

  /** A previously rendered picture by content hash (undefined if evicted). */
  async cached(hash: string): Promise<Uint8Array | undefined> {
    return /^[0-9a-f]{32}$/.test(hash) ? this.ctx.storage.get<Uint8Array>(`png:${hash}`) : undefined;
  }

  // ------------------------------------------------------------------ highlight clips (sharded by match)
  private clipBusy = new Map<string, Promise<any>>();
  private async hist(matchId: string) { return this.env.RENDER.get(this.env.RENDER.idFromName("history")).history(matchId); }

  async highlights(matchId: string): Promise<{ done: boolean; players: string[]; items: Highlight[] }> {
    const h = await this.hist(matchId);
    return { done: h.done, players: h.players, items: findHighlights(h) };
  }

  /** GIF + share card for one highlight. `which` = step number, "win" or "last". Cached in storage once the match is over. */
  async clip(matchId: string, which: string): Promise<{ meta: Highlight & { matchId: string; names: [string, string] }; gif: Uint8Array; card: Uint8Array } | undefined> {
    const key = `${matchId}:${which}`;
    const busy = this.clipBusy.get(key);
    if (busy) return busy;
    const p = this.makeClip(matchId, which).finally(() => this.clipBusy.delete(key));
    this.clipBusy.set(key, p);
    return p;
  }
  private async makeClip(matchId: string, which: string) {
    const h = await this.hist(matchId);
    const items = findHighlights(h);
    const hl = which === "win" ? items.find((x) => x.kind === "win") : which === "last" ? items[items.length - 1] : items.find((x) => String(x.step) === which);
    if (!hl) return undefined;
    const k = `clip:v1:${matchId}:${hl.step}`;
    const cached = await this.ctx.storage.get<{ meta: any; gif: Uint8Array; card: Uint8Array }>(k);
    if (cached) return cached;
    const c = cfg(this.env), house = privateKeyToAccount(this.env.HOUSE_KEY as Hex).address.toLowerCase();
    const names = h.players.map((a) => (!a || /^0x0{40}$/i.test(a) ? "" : a.toLowerCase() === house ? "TapeLog bot" : `${a.slice(0, 6)}…${a.slice(-4)}`)) as [string, string];
    try { const lad: any = this.env.LADDER.get(this.env.LADDER.idFromName("ladder")); for (let i = 0; i < 2; i++) if (names[i] && names[i] !== "TapeLog bot") { const e = await lad.get(h.players[i]); if (e?.name) names[i] = e.name; } } catch {}
    const looks = [await this.lookOf(h.players[0]), await this.lookOf(h.players[1])] as [Look, Look];
    const steps = clipSteps(h, hl.step);
    const W = 420, frames: Uint8Array[] = [], delays: number[] = [];
    let height = 0, keyPng: Uint8Array | undefined;
    const env = await this.envImage(looks[0].table);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], last = actionOf(s);
      const sc = sceneFrom(s.state as any, -1, undefined, [looks[0], looks[1]], last);
      sc.names = names;
      const svg = boardSvg(sc, { envImage: env });
      const px = await svgToRgba(svg, W);
      frames.push(px.data); height = px.height;
      const isKey = i === steps.length - 1;
      delays.push(isKey ? 2600 : i === 0 ? 900 : 750);
      if (isKey) keyPng = await svgToPng(svg, 530);
    }
    if (!frames.length || !keyPng) return undefined;
    const gif = encodeGif(frames, W, height, delays);
    const card = await svgToPng(cardSvg({ frame: "data:image/png;base64," + b64(keyPng), title: hl.title, detail: hl.detail, matchId, names, ply: hl.ply }));
    const out = { meta: { ...hl, matchId, names }, gif, card };
    // keep finished highlights (they never change); cap the cache
    if (gif.length + card.length < 1_900_000) {
      const idx = ((await this.ctx.storage.get<string[]>("clipIndex")) ?? []).filter((x) => x !== k);
      idx.push(k);
      const drop = idx.length > 60 ? idx.splice(0, idx.length - 60) : [];
      await this.ctx.storage.put({ [k]: out, clipIndex: idx });
      if (drop.length) await this.ctx.storage.delete(drop);
    }
    void c;
    return out;
  }

  // ------------------------------------------------------------------ board-link aliases (instance "history")
  /** First claim wins; the same player may re-claim its own alias. */
  async claimAlias(alias: string, objectId: string): Promise<{ ok: boolean; reason?: string }> {
    const cur = await this.ctx.storage.get<string>(`alias:${alias}`);
    if (cur && cur !== objectId) return { ok: false, reason: "that board link name is already taken; pick another random name" };
    await this.ctx.storage.put(`alias:${alias}`, objectId);
    return { ok: true };
  }
  async aliasOwner(alias: string) { return this.ctx.storage.get<string>(`alias:${alias}`); }

  // ------------------------------------------------------------------ match history (instance "history")
  private hmem = new Map<string, { at: number; h: History }>();

  async history(idStr: string): Promise<History> {
    const c = cfg(this.env), id = BigInt(idStr);
    const done = await this.ctx.storage.get<History>(`hist:${idStr}`);
    if (done) return done;
    const m = this.hmem.get(idStr);
    if (m && Date.now() - m.at < 4000) return m.h;
    let created = await this.ctx.storage.get<string>(`created:${idStr}`);
    if (!created) {
      const scanned = BigInt((await this.ctx.storage.get<string>("scanned")) ?? String(GAME_DEPLOY_BLOCK - 1n));
      const to = await head();
      if (scanned < to) {
        const found = await scanCreated(c.game, scanned + 1n, to);
        const puts: Record<string, string> = { scanned: to.toString() };
        for (const [k, v] of Object.entries(found)) puts[`created:${k}`] = v;
        const entries = Object.entries(puts);
        for (let i = 0; i < entries.length; i += 100) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 100)));
        created = found[idStr];
      }
    }
    if (!created) throw new Error(`match #${idStr} not found`);
    const h = await loadHistory(c.rpcUrl, c.game, id, BigInt(created));
    if (h.done) await this.ctx.storage.put(`hist:${idStr}`, h);
    this.hmem.set(idStr, { at: Date.now(), h });
    return h;
  }
}
