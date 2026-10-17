# Fogline

**A hidden-army strategy game played fully onchain, by people and AI agents.** An open-source TapeLog project.

> **Game for entertainment. Not investment advice.**
> **Testnet only.** Stakes use a valueless test token on Base Sepolia (or a local chain). Real-money wagering on mainnet is **disabled** pending owner legal review. See [LEGAL.md](LEGAL.md).

Each side commits a secret army as salted hashes. Everyone can see *where* your pieces stand but not *what* they are. Every move is a transaction. When two pieces clash, both ranks are revealed and the contract checks them against the commitments. Capture the enemy **Beacon** to win. If you stall past your turn timer, you forfeit.

## Rules

| Piece | Rank | Count | Notes |
|---|---|---|---|
| Warden | 7 | 1 | Strongest piece |
| Captain | 6 | 1 | |
| Knight | 5 | 2 | |
| Guard | 4 | 3 | |
| Sapper | 3 | 2 | Defuses Mines |
| Scout | 2 | 3 | Moves 1–3 squares in a straight line. A long move reveals it |
| Ghost | 1 | 1 | Weakest, but **ambushes the Warden** when it attacks |
| Mine | — | 2 | Immobile and **single use**: the attacker and the Mine are both removed. A Sapper defuses it and survives |
| Beacon | — | 1 | Immobile. Lose it and you lose |

- **Board.** The board is 8×8 and squares are numbered `row*8 + col`. Two impassable **fog banks** sit at squares 26 and 37.
- **Setup.** Side A (the creator) fills rows 0–1 and side B fills rows 6–7. Piece *i* starts on a fixed square, and its rank is hidden.
- **Movement.** Pieces move one square orthogonally, except Scouts, which move up to 3. You can't move onto your own pieces or the fog banks.
- **Combat.**
  - The higher rank wins.
  - **Ties go to the defender**, who holds its ground.
  - The Ghost ambushes the Warden when it attacks.
  - Mines are single use, and Sappers defuse them.
  - Any attack on the Beacon captures it.
- **Turn timer.** Each match sets a turn timeout of 60 seconds to 7 days. Once it expires, anyone can call `claimTimeout`. A defender who won't reveal also forfeits.
- **Draw.** After 400 plies the match is a draw and both stakes are refunded.
- **Anti-cheat.**
  - Every piece is bound to `keccak256(matchId, player, index, rank, salt)`.
  - A piece that has moved can never later reveal as a Beacon or Mine. If it does, its owner loses on the spot.
  - Before collecting, the **winner must reveal the whole army** (`verifyLayout`) to prove it had the right composition and never moved an immobile piece. A winner who can't prove this within the timeout loses the pot to the other side (`claimUnverified`).

## What's in the repo

| Path | What |
|---|---|
| `src/Fogline.sol` | Game, commit-reveal, combat, timeouts, ERC-20 stake escrow (0% fee). The constructor **refuses any chain except Base Sepolia 84532 and local 31337** |
| `src/FoglineCosmetics.sol` | ERC-1155 piece skins and board themes. **Purely decorative**: the game contract never reads it. Items can be bought in an ERC-20 (USDC-style) or minted by an approved minter after an off-chain payment (for example x402) |
| `src/MockUSDC.sol` | Valueless 6-decimal test token with a public faucet |
| `script/Deploy.s.sol` | Deploys all three to testnet or a local chain. Refuses other chains |
| `script/DeployCosmeticsMainnet.s.sol` | *Future:* cosmetics only, priced in Base USDC. Refuses unless `ALLOW_MAINNET_COSMETICS=yes-owner-approved` |
| `test/` | Foundry tests: commit-reveal, combat, fog banks, win, timeouts, escrow payouts, draws, anti-cheat, cosmetics |
| `agent/` | TypeScript agent SDK, baseline bot, `fogline` CLI, bot-vs-bot demo, and an MCP server so AI assistants can play |
| `docs/` | Static match viewer (replay files or live RPC), ready for GitHub Pages |

## Quick start (local chain)

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
git clone --recursive https://github.com/tapelog-journal/fogline && cd fogline
forge test                       # contract tests
anvil &                          # local chain
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil's public dev key
cd agent && npm install && npm run abi && npm test
npm run demo                     # two bots play a full staked match and write demo/last-match.json
```

Then open `docs/index.html` with any static server (`python3 -m http.server -d docs`) to replay the match.

## Agents

```ts
import { FoglineClient } from "./agent/src/client.js";
import { botStep } from "./agent/src/bot.js";

const me = new FoglineClient({ rpcUrl, chainId: 84532, game, privateKey }); // testnet key only
const id = await me.createMatch({ stake: 0n, turnTimeout: 600 });
// ...opponent joins...
for (;;) { const { action, log } = await botStep(me, id); console.log(log); if (action.kind === "done") break; }
```

The SDK does the following for you:

- Generates a legal random army.
- Stores layout salts and bot keys **outside the repo** in `~/.fogline`, with files set to mode 600.
- Commits the hashes.
- Reveals automatically when it attacks, when a Scout makes a long move, and when it defends.
- Claims timeouts and proves the army at the end.

To build a stronger player, replace `decide()` in `agent/src/bot.ts`.

**CLI:** run `npx tsx agent/src/cli.ts help`. The commands are `create`, `join`, `state`, `step`, `play`, `move` and `resign`. Configure it with `FOGLINE_CHAIN_ID`, `FOGLINE_RPC` and `FOGLINE_KEY_NAME`.

**MCP:** run `node agent/dist/mcp.js` after `npm run build`. The tools are:

- `fogline_rules`
- `fogline_state` (the board plus legal moves)
- `fogline_create`
- `fogline_join`
- `fogline_move`
- `fogline_auto_step`
- `fogline_resign`

Secrets never leave the machine and are never returned to the model.

## Gas (from the Foundry gas report)

| Call | Typical gas |
|---|---|
| `commitLayout` (16 pieces) | ~811k |
| `move` | ~51k |
| `revealDefense` | ~57k |
| `verifyLayout` + payout | ~180k |
| `createMatch` / `joinMatch` with stake | ~144k / ~61k |

## Cosmetics roadmap

Cosmetics are ordinary purchases with no effect on play, so they could later be sold on Base mainnet in USDC, either directly through `buy()` or through an x402 pay-per-call endpoint whose server holds the `minter` role and calls `mintTo()`. Nothing is on mainnet today.

## License

MIT. Fogline is an original game with its own name, pieces and rules. It is not affiliated with any other board game or trademark.

**Game for entertainment. Not investment advice.**
