// Bot vs bot: two throwaway agent wallets play a full staked Fogline match (testnet / local chain).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestClient, http, parseEther, formatUnits } from "viem";
import { foundry } from "viem/chains";
import { FoglineClient } from "./client.js";
import { botStep } from "./bot.js";
import { envConfig, REPO_ROOT } from "./config.js";
import { botKey } from "./secrets.js";
import { END_REASONS, Phase, renderBoard, type GameState } from "./rules.js";
import { mockUsdcAbi } from "./abi.js";

const cfg = envConfig();
const STAKE = 25_000_000n; // 25 test fUSD (valueless)
const mk = (name: string) => new FoglineClient({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, game: cfg.game, privateKey: botKey(`${name}-${cfg.chainId}`) });
const alpha = mk("alpha"), bravo = mk("bravo");

if (cfg.chainId === 31337) {
  const t = createTestClient({ chain: foundry, mode: "anvil", transport: http(cfg.rpcUrl) });
  for (const b of [alpha, bravo]) await t.setBalance({ address: b.address, value: parseEther("10") });
}
console.log(`chain ${cfg.chainId}  game ${cfg.game}`);
console.log(`alpha ${alpha.address}\nbravo ${bravo.address}`);

const bal = async (c: FoglineClient) => (await c.pub.readContract({ address: cfg.token, abi: mockUsdcAbi, functionName: "balanceOf", args: [c.address] })) as bigint;
for (const b of [alpha, bravo]) await b.faucetAndApprove(cfg.token, STAKE);
const before = [await bal(alpha), await bal(bravo)];

const id = await alpha.createMatch({ token: cfg.token, stake: STAKE, turnTimeout: 600 });
console.log(`match #${id} created, stake ${formatUnits(STAKE, 6)} fUSD each (escrowed)`);
await bravo.joinMatch(id);

const snapshots: { step: number; log: string; tx?: string; state: unknown }[] = [];
const ser = (s: GameState) => JSON.parse(JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
let state = await alpha.state(id);
let n = 0;
const rnd = mulberry(Number(process.env.FOGLINE_SEED ?? 7));
while (state.match.phase !== Phase.Settled && n < 2000) {
  for (const b of [alpha, bravo]) {
    let res;
    try { res = await botStep(b, id, { rnd }); } catch (e) { console.log(`retrying after RPC error: ${(e as Error).message.split("\n")[0]}`); await new Promise((r) => setTimeout(r, 3000)); continue; }
    const { action, log } = res;
    if (action.kind !== "wait" && action.kind !== "done") {
      n++;
      state = await alpha.state(id);
      snapshots.push({ step: n, log, tx: b.txs[b.txs.length - 1]?.hash, state: ser(state) } as any);
      if (action.kind !== "move" || n % 20 === 0) console.log(`[${n}] ${log}`);
    }
  }
  state = await alpha.state(id);
}
const after = [await bal(alpha), await bal(bravo)];
const m = state.match;
console.log("\nFinal public board (a = alpha, b = bravo, ? = still hidden):");
console.log(renderBoard(state));
console.log(`\nresult: ${m.winner === 2 ? "draw" : `winner side ${m.winner} (${m.winner === 0 ? "alpha" : "bravo"})`}, reason ${END_REASONS[m.reason]}, plies ${m.ply}`);
console.log(`alpha fUSD ${formatUnits(before[0], 6)} -> ${formatUnits(after[0], 6)}; bravo fUSD ${formatUnits(before[1], 6)} -> ${formatUnits(after[1], 6)}`);

const outDir = join(REPO_ROOT, "demo");
mkdirSync(outDir, { recursive: true });
const allTxs = [...alpha.txs.map((t) => ({ who: "alpha", ...t })), ...bravo.txs.map((t) => ({ who: "bravo", ...t }))];
const replay = { txs: allTxs, chainId: cfg.chainId, game: cfg.game, matchId: id.toString(), players: m.players, winner: m.winner, reason: END_REASONS[m.reason], plies: m.ply, balances: { before: before.map(String), after: after.map(String) }, snapshots };
writeFileSync(join(outDir, "last-match.json"), JSON.stringify(replay));
writeFileSync(join(outDir, `match-${cfg.chainId}-${id}.json`), JSON.stringify(replay));
console.log(`replay written to demo/last-match.json (${snapshots.length} steps)`);

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
