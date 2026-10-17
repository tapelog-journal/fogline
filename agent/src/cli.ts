#!/usr/bin/env node
// fogline CLI - lets a person or AI agent play Fogline from a terminal. Testnet / local only.
// Game for entertainment. Not investment advice.
import type { Address, Hex } from "viem";
import { FoglineClient } from "./client.js";
import { botStep } from "./bot.js";
import { envConfig } from "./config.js";
import { botKey } from "./secrets.js";
import { END_REASONS, Phase, renderBoard } from "./rules.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const HELP = `fogline <command> [options]
  address                          print this agent's address
  faucet                           mint 1000 test fUSD and approve the game
  create [--stake 10] [--timeout 600] [--opponent 0x..]   create a match (stake in fUSD)
  join <matchId>                   join a match (escrows the same stake)
  state <matchId>                  show phase and board
  step <matchId>                   let the baseline bot take one action
  play <matchId>                   let the baseline bot play until the match settles
  move <matchId> <from> <to>       make a manual move (reveals automatically if needed)
  resign <matchId>
env: FOGLINE_CHAIN_ID (31337 | 84532), FOGLINE_RPC, FOGLINE_KEY_NAME (bot key name, default "agent")
     or FOGLINE_PRIVATE_KEY (testnet key; never commit it)`;

const cfg = envConfig();
const key = (process.env.FOGLINE_PRIVATE_KEY as Hex) ?? botKey(`${process.env.FOGLINE_KEY_NAME ?? "agent"}-${cfg.chainId}`);
const c = new FoglineClient({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, game: cfg.game as Address, privateKey: key });
const id = () => BigInt(args[0]);

async function show(mid: bigint) {
  const s = await c.state(mid);
  const side = c.sideOf(s);
  const l = c.layout(mid);
  console.log(`match #${mid} phase=${Phase[s.match.phase]} turn=${s.match.turn} ply=${s.match.ply} you=side ${side} winner=${s.match.winner} reason=${END_REASONS[s.match.reason]}`);
  console.log(renderBoard(s, side >= 0 && l ? { side, ranks: l.ranks } : undefined));
}

switch (cmd) {
  case "address": console.log(c.address); break;
  case "faucet": await c.faucetAndApprove(cfg.token, 2n ** 255n); console.log("ok"); break;
  case "create": {
    const stake = BigInt(Math.round(Number(flag("stake", "0")) * 1e6));
    const mid = await c.createMatch({ token: stake > 0n ? cfg.token : undefined, stake, turnTimeout: Number(flag("timeout", "600")), opponent: flag("opponent") as Address | undefined });
    console.log(`created match #${mid}`); break;
  }
  case "join": await c.joinMatch(id()); console.log("joined"); break;
  case "state": await show(id()); break;
  case "step": console.log((await botStep(c, id())).log); break;
  case "play": {
    for (;;) {
      const { action, log } = await botStep(c, id());
      if (action.kind === "done") { console.log(log); break; }
      if (action.kind !== "wait") console.log(log);
      else await new Promise((r) => setTimeout(r, cfg.chainId === 31337 ? 200 : 3000));
    }
    await show(id()); break;
  }
  case "move": {
    const mid = id(), from = Number(args[1]), to = Number(args[2]);
    const s = await c.state(mid), side = c.sideOf(s), l = c.layout(mid);
    if (!l) throw new Error("no local layout for this match");
    const i = (s.board[from] - 1) % 16;
    await c.move(mid, from, to, l.ranks[i], l.salts[i]);
    await show(mid); break;
  }
  case "resign": await c.resign(id()); console.log("resigned"); break;
  default: console.log(HELP);
}
