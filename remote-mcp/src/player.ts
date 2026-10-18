// One Durable Object per player session. Holds a throwaway Base Sepolia key and the secret army
// salts for each match, signs that player's transactions, and never returns secrets to the model.
import { DurableObject } from "cloudflare:workers";
import { formatEther, formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { commitments, isLegalComposition, randomLayout, type Layout } from "../../agent/src/layout";
import { legalMoves, Phase, PIECES, RANK_NAMES } from "../../agent/src/rules";
import { combatNote, gameCall, matchIdFrom, mockUsdcAbi, narrate, pub, readState, sendTx, tokenCall, type SentTx } from "./chain";
import { cfg, DEFAULT_TURN_TIMEOUT, txLink, watchLink, type Env } from "./env";
import { Mutex, nonceStore } from "./store";
import { boardMd, boardView, coord, diffEvents, groupMoves, sideOf, summary, type LastMove } from "./view";
import { DEFAULT_LOOK_PAIR, ladder, renderer } from "./env";
import { sceneFrom } from "./render";
import { viewToken } from "./boardimg";
import { cosmeticsCall, findItem, ITEMS, ownedBy } from "./cosmetics";
import type { Level } from "../../agent/src/levels";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class UserError extends Error {}

export interface TxOut { fn: string; hash: string; url: string }
const out = (t: SentTx): TxOut => ({ fn: t.fn, hash: t.hash, url: txLink(t.hash) });

export class Player extends DurableObject<Env> {
  private lock = new Mutex();
  private ladderSynced = false;

  private async key(): Promise<Hex> {
    const k = await this.ctx.storage.get<Hex>("key");
    if (!k) throw new UserError("Unknown session. Call fogline_new_player first and pass the session it returns.");
    return k;
  }
  private async address(): Promise<Address> { return privateKeyToAccount(await this.key()).address; }
  private async session(): Promise<string> { return (await this.ctx.storage.get<string>("session"))!; }
  private houseAddress(): Address { return privateKeyToAccount(this.env.HOUSE_KEY as Hex).address; }
  private async layout(id: bigint) { return this.ctx.storage.get<Layout>(`layout:${id}`); }

  private async tx(fn: string, data: Hex, to?: Address): Promise<SentTx> {
    const c = cfg(this.env), key = await this.key();
    const send = () => sendTx({ rpc: c.rpcUrl, key, to: to ?? c.game, data, fn, nonces: nonceStore(this.ctx.storage), attempts: 3 });
    try { return await send(); }
    catch (e: any) {
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      if (/insufficient funds|exceeds the balance/i.test(msg)) {
        const r = await this.env.FUNDER.get(this.env.FUNDER.idFromName("funder")).topUp(await this.session(), await this.address());
        if (!r.ok) throw new UserError(`Out of testnet gas and no top-up available: ${r.reason}`);
        return await send();
      }
      throw new UserError(`${fn} failed: ${explain(msg)}`);
    }
  }

  // ------------------------------------------------------------------ session

  async init(session: string, ip: string) {
    return this.lock.run(async () => {
      if (await this.ctx.storage.get("key")) throw new UserError("session already exists");
      const key = generatePrivateKey();
      await this.ctx.storage.put({ key, session, created: Date.now() });
      const address = privateKeyToAccount(key).address;
      const funding = await this.env.FUNDER.get(this.env.FUNDER.idFromName("funder")).grant(session, address, ip);
      let faucet: TxOut | undefined;
      if (funding.ok) {
        try { faucet = out(await this.tx("faucet", tokenCall("faucet", []), cfg(this.env).token)); } catch (e) { console.log("faucet failed", String(e)); }
      }
      return { address, funding: { ...funding, url: funding.hash ? txLink(funding.hash) : undefined }, faucet };
    });
  }

  /** Optional public profile: a handle the player chose and the client kind it reported (self-report only). */
  async setProfile(name?: string, client?: string) {
    const address = await this.address();
    const cur = (await this.ctx.storage.get<{ name?: string; client?: string }>("profile")) ?? {};
    const next = { name: name === undefined ? cur.name : name || undefined, client: client ?? cur.client };
    await this.ctx.storage.put("profile", next);
    try { await ladder(this.env).register(address, next.name ?? "", next.client); } catch (e) { console.log("ladder register failed", String(e).slice(0, 120)); }
    return { address, ...next };
  }
  async profile() { return { address: await this.address(), ...((await this.ctx.storage.get<{ name?: string; client?: string }>("profile")) ?? {}) }; }

  async info() {
    const c = cfg(this.env), address = await this.address(), p = pub(c.rpcUrl);
    const [eth, fusd] = await Promise.all([
      p.getBalance({ address }),
      p.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
    ]);
    return { address, eth: formatEther(eth), fUSD: formatUnits(fusd, 6), matches: (await this.ctx.storage.get<string[]>("matches")) ?? [] };
  }

  private async remember(id: bigint) {
    const ms = (await this.ctx.storage.get<string[]>("matches")) ?? [];
    if (!ms.includes(id.toString())) { ms.push(id.toString()); await this.ctx.storage.put("matches", ms.slice(-50)); }
  }

  private async stakeSetup(stake: bigint): Promise<SentTx[]> {
    const c = cfg(this.env), txs: SentTx[] = [];
    if (stake <= 0n) return txs;
    const address = await this.address();
    const bal = (await pub(c.rpcUrl).readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] })) as bigint;
    if (bal < stake) txs.push(await this.tx("faucet", tokenCall("faucet", []), c.token));
    txs.push(await this.tx("approve", tokenCall("approve", [c.game, stake]), c.token));
    return txs;
  }

  // ------------------------------------------------------------------ matches

  /** Return a match this session created recently with the same idempotency ref (or within 120s when no ref). */
  private async recent(kind: string, ref?: string) {
    const r = await this.ctx.storage.get<{ at: number; matchId: string; ref?: string }>(`recent:${kind}`);
    if (!r) return undefined;
    if (ref ? r.ref === ref : Date.now() - r.at < 120_000) return r.matchId;
    return undefined;
  }

  async playBot(stakeUnits: string, turnTimeout?: number, ref?: string, level: Level = "normal") {
    return this.lock.run(async () => {
      const prior = await this.recent("bot", ref);
      if (prior) return { matchId: prior, joined: true, txs: [], watch: watchLink(this.env, prior), reused: true, level: (await this.ctx.storage.get<Level>(`level:${prior}`)) ?? "normal" };
      const stake = BigInt(stakeUnits);
      const house = this.env.HOUSE.get(this.env.HOUSE.idFromName("house"));
      if ((await house.activeCount()) >= 12) throw new UserError("The TapeLog house bot is busy with too many matches; try again in a few minutes.");
      const txs = await this.stakeSetup(stake);
      const created = await this.tx("createMatch", gameCall("createMatch", [stake > 0n ? cfg(this.env).token : zeroAddress, stake, turnTimeout ?? DEFAULT_TURN_TIMEOUT, this.houseAddress()]));
      txs.push(created);
      const id = matchIdFrom(created.receipt);
      await this.remember(id);
      await this.ctx.storage.put({ "recent:bot": { at: Date.now(), matchId: id.toString(), ref }, [`level:${id}`]: level });
      const w = await house.watch(id.toString(), await this.session(), level);
      if (!w.ok) throw new UserError(w.reason!);
      // wait (briefly) for the house bot to join so the player can place their army right away
      let s = await readState(cfg(this.env).rpcUrl, cfg(this.env).game, id, created.receipt.blockNumber);
      for (let i = 0; i < 14 && s.match.phase === Phase.Open; i++) { await sleep(2000); s = await readState(cfg(this.env).rpcUrl, cfg(this.env).game, id); }
      return { matchId: id.toString(), joined: s.match.phase !== Phase.Open, txs: txs.map(out), watch: watchLink(this.env, id), level };
    });
  }

  async create(stakeUnits: string, opponent: string | undefined, turnTimeout?: number, ref?: string) {
    return this.lock.run(async () => {
      const prior = await this.recent("create", ref);
      if (prior) return { matchId: prior, txs: [], watch: watchLink(this.env, prior), reused: true };
      const stake = BigInt(stakeUnits);
      const txs = await this.stakeSetup(stake);
      const created = await this.tx("createMatch", gameCall("createMatch", [stake > 0n ? cfg(this.env).token : zeroAddress, stake, turnTimeout ?? DEFAULT_TURN_TIMEOUT, (opponent as Address) ?? zeroAddress]));
      txs.push(created);
      const id = matchIdFrom(created.receipt);
      await this.remember(id);
      await this.ctx.storage.put("recent:create", { at: Date.now(), matchId: id.toString(), ref });
      return { matchId: id.toString(), txs: txs.map(out), watch: watchLink(this.env, id) };
    });
  }

  async join(idStr: string) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr);
      const s = await readState(c.rpcUrl, c.game, id);
      if (sideOf(s, await this.address()) >= 0) return { matchId: idStr, txs: [], watch: watchLink(this.env, id), already: true };
      if (s.match.phase !== Phase.Open) throw new UserError(`match #${id} is not open to join (phase ${Phase[s.match.phase]})`);
      if (s.match.stake > 0n && s.match.token.toLowerCase() !== c.token.toLowerCase()) throw new UserError("that match uses an unknown token; refusing");
      const txs = await this.stakeSetup(s.match.stake);
      txs.push(await this.tx("joinMatch", gameCall("joinMatch", [id])));
      await this.remember(id);
      return { matchId: idStr, txs: txs.map(out), watch: watchLink(this.env, id) };
    });
  }

  async commitArmy(idStr: string, ranks?: number[]) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr), address = await this.address();
      const s = await readState(c.rpcUrl, c.game, id);
      const side = sideOf(s, address);
      if (side < 0) throw new UserError(`you are not a player in match #${id}`);
      if (s.match.phase === Phase.Open) throw new UserError("the match has no opponent yet; wait for them to join");
      if (s.match.committed[side] || s.match.phase > Phase.Committing) {
        return { txs: [], ...(await this.render(s, side, await this.layout(id))), events: ["your army was already placed (nothing changed)"], already: true };
      }
      let l: Layout;
      if (ranks) {
        if (!isLegalComposition(ranks)) throw new UserError("illegal army: need exactly 1 Beacon, 1 Ghost, 3 Scouts, 2 Sappers, 3 Guards, 2 Knights, 1 Captain, 1 Warden, 2 Mines (16 pieces)");
        l = { ranks, salts: randomLayout(side).salts };
      } else l = (await this.layout(id)) ?? randomLayout(side);
      await this.ctx.storage.put(`layout:${id}`, l); // persist secrets before committing
      const t = await this.tx("commitLayout", gameCall("commitLayout", [id, commitments(id, address, l)]));
      if (s.match.players.some((p) => p.toLowerCase() === this.houseAddress().toLowerCase())) await this.kickHouse(id, t.receipt.blockNumber);
      const after = await this.waitTurn(id, side, t.receipt.blockNumber, 24_000);
      const lt = await this.story(id, side, t.receipt.blockNumber, after.block);
      return { txs: [out(t)], ...(await this.render(after, side, l, lt.last ? lt : undefined)), events: lt.lines.filter((x) => !/verified/.test(x)) };
    });
  }

  async move(idStr: string, from: number, to: number, expectedPly?: number) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr), address = await this.address();
      let s = await readState(c.rpcUrl, c.game, id);
      const side = sideOf(s, address), l = await this.layout(id);
      if (expectedPly !== undefined && side >= 0 && s.match.ply !== expectedPly) {
        // idempotency: the same move URL fetched twice must not move twice
        return { txs: [], stale: true, events: [`Not moved: this link was for ply ${expectedPly} but the match is at ply ${s.match.ply} (the move was probably already made). Here is the current board.`], ...(await this.render(s, side, l, await this.sinceSeen(id, side, s.block))) };
      }
      if (side < 0) throw new UserError(`you are not a player in match #${id}`);
      if (!l) throw new UserError("you have not placed an army in this match yet (fogline_auto_army)");
      const txs: SentTx[] = [], events: string[] = [];
      if (s.match.phase === Phase.PendingReveal && s.match.turn === side) {
        const r = await this.reveal(id, s, l); txs.push(r); events.push(note(r, "your defender was revealed"));
        s = await readState(c.rpcUrl, c.game, id, r.receipt.blockNumber);
      }
      if (s.match.phase !== Phase.Playing) throw new UserError(`cannot move now: phase ${Phase[s.match.phase]}`);
      if (s.match.turn !== side) throw new UserError("it is not your turn; call fogline_state to see when it is");
      const legal = legalMoves(s, side, l.ranks);
      const mv = legal.find((m) => m.from === from && m.to === to);
      if (!mv) {
        const fromHere = legal.filter((m) => m.from === from).map((m) => m.to);
        throw new UserError(`illegal move ${coord(from)} → ${coord(to)}. ${fromHere.length ? `Legal targets from ${coord(from)}: ${fromHere.map(coord).join(", ")}.` : `No legal moves from ${coord(from)}.`} All legal moves: ${legal.map((m) => `${coord(m.from)}→${coord(m.to)}`).join(" ")}`);
      }
      const before = s;
      const t = await this.tx("move", gameCall("move", [id, from, to, l.ranks[mv.pieceIndex], l.salts[mv.pieceIndex]]));
      txs.push(t);
      const moveNote = `You ${mv.attack ? "attacked" : "moved"} ${coord(from)} → ${coord(to)} with your ${RANK_NAMES[l.ranks[mv.pieceIndex]]}`;
      if (s.match.players.some((p) => p.toLowerCase() === this.houseAddress().toLowerCase())) await this.kickHouse(id, t.receipt.blockNumber);
      const after = await this.waitTurn(id, side, t.receipt.blockNumber, 30_000, txs, []);
      const story = await this.story(id, side, t.receipt.blockNumber, after.block);
      if (story.lines.length) { story.lines[0] = story.lines[0].replace(/^You (moved|attacked) [a-h][1-8] → [a-h][1-8]/, moveNote); events.push(...story.lines); }
      else events.push(moveNote, ...diffEvents(before, after, side));
      return { txs: txs.map(out), events, ...(await this.render(after, side, l, story)) };
    });
  }

  /** Narrate events in a block range, remember them as this match's "last turn", and remember what we've seen. */
  private async story(id: bigint, side: number, fromBlock: bigint, toBlock: bigint): Promise<{ lines: string[]; last?: LastMove }> {
    const c = cfg(this.env);
    const r = (await narrate(c.rpcUrl, c.game, id, fromBlock, toBlock, side, RANK_NAMES)) ?? { lines: [] };
    await this.ctx.storage.put(`seen:${id}`, toBlock.toString());
    if (r.lines.length) await this.ctx.storage.put(`last:${id}`, r);
    return r;
  }
  /** Events since this session last looked at the match (or the stored last turn). */
  private async sinceSeen(id: bigint, side: number, toBlock: bigint): Promise<{ lines: string[]; last?: LastMove }> {
    const seen = await this.ctx.storage.get<string>(`seen:${id}`);
    if (seen && BigInt(seen) < toBlock) { const r = await this.story(id, side, BigInt(seen) + 1n, toBlock); if (r.lines.length) return r; }
    return (await this.ctx.storage.get<{ lines: string[]; last?: LastMove }>(`last:${id}`)) ?? { lines: [] };
  }

  /** Wait until it's this player's turn again (auto-revealing our defenders, auto-verifying a win). */
  private async waitTurn(id: bigint, side: number, minBlock: bigint, budgetMs: number, txs: SentTx[] = [], events: string[] = []) {
    const c = cfg(this.env), t0 = Date.now(), l = await this.layout(id);
    let s = await readState(c.rpcUrl, c.game, id, minBlock);
    while (true) {
      const m = s.match;
      if (m.phase === Phase.PendingReveal && m.turn === side && l) {
        const r = await this.reveal(id, s, l); txs.push(r); events.push(note(r, "your defender was revealed"));
        await this.kickHouse(id, r.receipt.blockNumber);
        s = await readState(c.rpcUrl, c.game, id, r.receipt.blockNumber); continue;
      }
      if (m.phase === Phase.Ended && m.winner === side && !m.verified[side] && l) {
        const r = await this.tx("verifyLayout", gameCall("verifyLayout", [id, l.ranks, l.salts])); txs.push(r);
        events.push("you won! your army was verified onchain and the match settled");
        s = await readState(c.rpcUrl, c.game, id, r.receipt.blockNumber); continue;
      }
      const mine = (m.phase === Phase.Playing && m.turn === side) || m.phase >= Phase.Ended || (m.phase === Phase.Committing && !m.committed[side]);
      if (mine || Date.now() - t0 > budgetMs) return s;
      await sleep(2000);
      s = await readState(c.rpcUrl, c.game, id);
    }
  }

  private async reveal(id: bigint, s: Awaited<ReturnType<typeof readState>>, l: Layout) {
    const i = (s.board[s.match.pendTo] - 1) % PIECES;
    return this.tx("revealDefense", gameCall("revealDefense", [id, l.ranks[i], l.salts[i]]));
  }

  private async kickHouse(id: bigint, minBlock?: bigint) {
    try { await this.env.HOUSE.get(this.env.HOUSE.idFromName("house")).kick(id.toString(), minBlock?.toString()); } catch (e) { console.log("kick failed", String(e)); }
  }

  private async render(s: Awaited<ReturnType<typeof readState>>, side: number, l?: Layout, lastTurn?: { lines: string[]; last?: LastMove }) {
    const v = boardView(s, side, l), sm = summary(s, side);
    const legal = v.moves.map((m) => ({ from: m.from, to: m.to, fromSq: coord(m.from), toSq: coord(m.to), piece: l ? RANK_NAMES[l.ranks[m.pieceIndex]] : undefined, attack: m.attack }));
    const scene = sceneFrom(s, side, l, DEFAULT_LOOK_PAIR());
    if (!this.ladderSynced) { this.ladderSynced = true; this.ctx.waitUntil((async () => { const pr = await this.ctx.storage.get<{ name?: string; client?: string }>("profile"); if (pr) await ladder(this.env).register(await this.address(), pr.name ?? "", pr.client); })().catch(() => {})); }
    if (s.match.phase === Phase.Settled) this.ctx.waitUntil(ladder(this.env).check(s.id.toString()).catch(() => {}) as Promise<any>);
    return {
      scene, players: [s.match.players[0], s.match.players[1]] as [string, string], block: s.block?.toString() ?? "0",
      viewToken: side >= 0 ? await viewToken(this.env, this.ctx.id.toString(), s.id.toString()) : undefined,
      boardAlias: side >= 0 ? await this.ctx.storage.get<string>("alias") : undefined,
      matchId: s.id.toString(), phase: Phase[s.match.phase], ply: s.match.ply, yourTurn: s.match.phase === Phase.Playing && s.match.turn === side, yourSide: side === 0 ? "A" : side === 1 ? "B" : "spectator", status: sm.status, summary: sm.line,
      board: v.ascii, boardMd: boardMd(s, side, l, lastTurn?.last), lastTurn: lastTurn?.lines ?? [],
      yourPieces: v.mine.map((x) => ({ ...x, sq: coord(x.square) })), enemyPieces: v.enemy.map((x) => ({ ...x, sq: coord(x.square) })),
      legalMoves: legal,
      movesByPiece: groupMoves(legal).map((g) => ({ piece: g.piece, from: coord(g.from), to: g.tos.map((t) => coord(t.to) + (t.attack ? "⚔️" : "")) })),
      watch: watchLink(this.env, s.id),
      botLevel: s.match.players.some((p) => p.toLowerCase() === this.houseAddress().toLowerCase()) ? ((await this.ctx.storage.get<Level>(`level:${s.id}`)) ?? "normal") : undefined,
      last: lastTurn?.last, deadline: Number(s.match.deadline), turn: Number(s.match.turn), winner: Number(s.match.winner), reason: Number(s.match.reason),
    };
  }

  async state(idStr: string) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr), address = await this.address();
      const s0 = await readState(c.rpcUrl, c.game, id);
      if (s0.match.phase === Phase.None) throw new UserError(`match #${id} does not exist`);
      const side = sideOf(s0, address), l = await this.layout(id);
      const s = s0, txs: SentTx[] = [], events: string[] = []; // read-only: no transactions here
      if (side >= 0 && s.match.players.some((p) => p.toLowerCase() === this.houseAddress().toLowerCase()) && s.match.phase < Phase.Settled) await this.kickHouse(id);
      const lt = side >= 0 ? await this.sinceSeen(id, side, s.block) : { lines: [] };
      return { txs: txs.map(out), events, ...(await this.render(s, side, l, lt)) };
    });
  }

  async resign(idStr: string) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr);
      const s0 = await readState(c.rpcUrl, c.game, id);
      if (s0.match.phase >= Phase.Ended) return { txs: [], events: ["match already over (nothing changed)"], ...(await this.render(s0, sideOf(s0, await this.address()), await this.layout(id))) };
      const t = await this.tx("resign", gameCall("resign", [id]));
      const s = await readState(c.rpcUrl, c.game, id, t.receipt.blockNumber);
      await this.kickHouse(id);
      const side = sideOf(s, await this.address());
      return { txs: [out(t)], ...(await this.render(s, side, await this.layout(id), await this.story(id, side, t.receipt.blockNumber, s.block))) };
    });
  }

  // ------------------------------------------------------------------ board picture + cosmetics

  /** Bind a user-chosen board-link name (lets ChatGPT show pictures whose URLs the user typed). */
  async setBoardAlias(alias: string) {
    await this.key();
    const r = await this.env.RENDER.get(this.env.RENDER.idFromName("history")).claimAlias(alias, this.ctx.id.toString());
    if (!r.ok) throw new UserError(r.reason!);
    await this.ctx.storage.put("alias", alias);
    return { alias };
  }
  async boardAlias() { return this.ctx.storage.get<string>("alias"); }
  /** Bind a picture to a board link: the same picture keeps its link; a new picture takes the next link (1..links, wrapping). */
  async recordAliasImage(matchId: string, hash: string, links: number): Promise<number> {
    const last = await this.ctx.storage.get<{ n: number; hash: string }>("vimg:last");
    if (last?.hash === hash) return last.n;
    const n = last ? (last.n % links) + 1 : 1;
    await this.ctx.storage.put({ [`vimg:${n}`]: { matchId, hash }, "vimg:last": { n, hash } });
    return n;
  }
  async aliasImage(n: number) { return this.ctx.storage.get<{ matchId: string; hash: string }>(`vimg:${n}`); }
  /** Picture of the latest match this player is in (fallback for a board link that was not issued yet). */
  async latestBoardPng(width?: number) {
    const ms = (await this.ctx.storage.get<string[]>("matches")) ?? [];
    if (!ms.length) throw new UserError("no match yet");
    return this.boardPng(ms[ms.length - 1], width);
  }

  /** PNG of this player's own view of a match (own ranks visible, enemy hidden unless revealed onchain). */
  async boardPng(idStr: string, width?: number) {
    const c = cfg(this.env), id = BigInt(idStr);
    const s = await readState(c.rpcUrl, c.game, id);
    const side = sideOf(s, await this.address());
    const scene = sceneFrom(s, side, side >= 0 ? await this.layout(id) : undefined, DEFAULT_LOOK_PAIR());
    return renderer(this.env, idStr).png({ scene, players: [s.match.players[0], s.match.players[1]], block: s.block.toString(), width });
  }

  async cosmetics() {
    const c = cfg(this.env), address = await this.address();
    const [o, fusd] = await Promise.all([
      ownedBy(c.rpcUrl, c.cosmetics, address),
      pub(c.rpcUrl).readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
    ]);
    return { address, owned: o.owned, equipped: o.equipped, fUSD: formatUnits(fusd, 6), items: ITEMS };
  }

  /** Buy one decorative item with valueless test fUSD (skipped if already owned), then equip skins/tabletops. */
  async buyCosmetic(q: string) {
    return this.lock.run(async () => {
      const it = findItem(q);
      if (!it) throw new UserError(`unknown cosmetic "${q}". Use the item id (1-22) or name from the cosmetics list.`);
      const c = cfg(this.env), address = await this.address(), p = pub(c.rpcUrl), txs: SentTx[] = [];
      const o = await ownedBy(c.rpcUrl, c.cosmetics, address);
      if (!o.owned.includes(it.id)) {
        const price = BigInt(it.price) * 1_000_000n;
        const [bal, allow] = await Promise.all([
          p.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          p.readContract({ address: c.token, abi: mockUsdcAbi, functionName: "allowance", args: [address, c.cosmetics] }) as Promise<bigint>,
        ]);
        if (bal < price) txs.push(await this.tx("faucet", tokenCall("faucet", []), c.token));
        if (allow < price) txs.push(await this.tx("approve", tokenCall("approve", [c.cosmetics, price * 50n]), c.token));
        txs.push(await this.tx("buy", cosmeticsCall("buy", [BigInt(it.id), 1]), c.cosmetics));
      }
      let equipped = false;
      if ((it.category === "skin" || it.category === "table") && o.equipped[it.kind] !== it.id) {
        txs.push(await this.tx("equip", cosmeticsCall("equip", [it.kind, BigInt(it.id)]), c.cosmetics));
        equipped = true;
      }
      return { item: it, alreadyOwned: o.owned.includes(it.id), equipped, txs: txs.map(out) };
    });
  }

  /** Called by the house bot when it attacked one of this player's pieces and the defender must be revealed. */
  async autoReveal(idStr: string) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr), l = await this.layout(id);
      if (!l) return { ok: false };
      const s = await readState(c.rpcUrl, c.game, id), side = sideOf(s, await this.address());
      if (s.match.phase !== Phase.PendingReveal || s.match.turn !== side) return { ok: false };
      const t = await this.reveal(id, s, l);
      await this.kickHouse(id, t.receipt.blockNumber);
      return { ok: true, hash: t.hash };
    });
  }

  /** Called by the house bot when this player won and has not verified yet. */
  async autoSettle(idStr: string) {
    return this.lock.run(async () => {
      const c = cfg(this.env), id = BigInt(idStr), l = await this.layout(id);
      if (!l) return { ok: false };
      const s = await readState(c.rpcUrl, c.game, id), side = sideOf(s, await this.address());
      if (s.match.phase !== Phase.Ended || s.match.winner !== side || s.match.verified[side]) return { ok: false };
      const t = await this.tx("verifyLayout", gameCall("verifyLayout", [id, l.ranks, l.salts]));
      return { ok: true, hash: t.hash };
    });
  }
}

function note(t: SentTx, fallback: string) { return combatNote(t.receipt, RANK_NAMES) || fallback; }

const ERRORS: Record<string, string> = {
  WrongPhase: "wrong phase for that action", NotYourTurn: "not your turn", NotPlayer: "you are not allowed in that match",
  BadSquare: "bad square", BadMove: "illegal move", Immobile: "that piece cannot move", BadTimeout: "turn timer must be 60..604800 seconds",
  NotExpired: "the turn timer has not expired", BadLayout: "illegal army", BadReveal: "reveal did not match the commitment", WrongChain: "wrong chain",
};
function explain(msg: string) {
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return `${v} (${k})`;
  return msg.split("\n")[0].slice(0, 240);
}
