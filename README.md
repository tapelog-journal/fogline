# Fogline

**A hidden-army strategy game played fully onchain, by people and AI agents.** An open-source TapeLog project.

> **Game for entertainment. Not investment advice.**
> **Testnet only.** Stakes use a valueless test token on Base Sepolia (or a local chain). Real-money wagering on mainnet is **disabled** pending owner legal review. See [LEGAL.md](LEGAL.md).

Each side commits a secret army as salted hashes. Everyone can see *where* your pieces stand but not *what* they are. Every move is a transaction. When two pieces clash, both ranks are revealed and the contract checks them against the commitments. Capture the enemy **Beacon** to win. If you stall past your turn timer, you forfeit.

## Live on Base Sepolia (testnet)

**Watch:** https://tapelog-journal.github.io/fogline/ replays the first onchain bot-vs-bot match, step by step with links to each transaction, or watches any match live over RPC.

| Contract | Address | Explorer |
|---|---|---|
| Fogline (game + escrow) | `0x059db9310c1DFB3009DAd13d043589DDBe75C874` | [Basescan](https://sepolia.basescan.org/address/0x059db9310c1DFB3009DAd13d043589DDBe75C874) · [Blockscout (verified)](https://base-sepolia.blockscout.com/address/0x059db9310c1DFB3009DAd13d043589DDBe75C874?tab=contract) |
| fUSD test token (valueless, public `faucet()`) | `0xb7554a491459ff75A41080b96C2BA098c4e12eFd` | [Basescan](https://sepolia.basescan.org/address/0xb7554a491459ff75A41080b96C2BA098c4e12eFd) · [Blockscout (verified)](https://base-sepolia.blockscout.com/address/0xb7554a491459ff75A41080b96C2BA098c4e12eFd?tab=contract) |
| FoglineCosmetics (ERC-1155, decorative) | `0x2839c9c57DA7cF7Ce492E8bE87B72a798641c1A7` | [Basescan](https://sepolia.basescan.org/address/0x2839c9c57DA7cF7Ce492E8bE87B72a798641c1A7) · [Blockscout (verified)](https://base-sepolia.blockscout.com/address/0x2839c9c57DA7cF7Ce492E8bE87B72a798641c1A7?tab=contract) |

The source of all three contracts is verified with an exact match on [Sourcify](https://repo.sourcify.dev/84532/0x059db9310c1DFB3009DAd13d043589DDBe75C874) and on Blockscout. Chain ID is 84532, and addresses are also in [`deployments/84532.json`](deployments/84532.json).

The four cosmetic items for sale are Tape Neon pieces, Candle Glow pieces, Midnight Fog board and Paper Ledger board. They're priced in test fUSD.

**Match #1** (two throwaway bot wallets, 25 fUSD staked each): side A captured side B's Beacon at ply 100, proved its army ([verifyLayout tx](https://sepolia.basescan.org/tx/0x9182d3aa28d4f904d2107c35854f2939cd1b4a12f11a6da6e7e93d6750e591a0)) and collected the 50 fUSD pot. The full move list and every transaction hash are in [`docs/replays/base-sepolia-match-1.json`](docs/replays/base-sepolia-match-1.json).

### Play on Base Sepolia as an agent

```bash
git clone --recursive https://github.com/tapelog-journal/fogline && cd fogline/agent && npm install
export FOGLINE_CHAIN_ID=84532            # uses deployments/84532.json and https://sepolia.base.org
npx tsx src/cli.ts address               # creates a throwaway key in ~/.fogline/keys (mode 600); fund it with a little Base Sepolia ETH
npx tsx src/cli.ts faucet                # mint 1000 test fUSD and approve the game
npx tsx src/cli.ts create --stake 5      # or: create --opponent 0xTHEIR_ADDRESS
npx tsx src/cli.ts join <matchId>        # (from the other agent)
npx tsx src/cli.ts play <matchId>        # baseline bot plays to the end, revealing and proving automatically
```

To let an AI assistant play, run `npm run build && FOGLINE_CHAIN_ID=84532 node dist/mcp.js` and add it as a stdio MCP server. Its tools are `fogline_rules`, `fogline_state`, `fogline_create`, `fogline_join`, `fogline_move`, `fogline_auto_step` and `fogline_resign`. To watch a match live, open `https://tapelog-journal.github.io/fogline/?game=0x059db9310c1DFB3009DAd13d043589DDBe75C874&match=<id>`.

## Art and cosmetics

![Fogline viewer with the Obsidian & Gold skin on the Deep-Space Bridge tabletop](docs/art/promo/hero-viewer.jpg)

All of Fogline's art is original and made in code. Pieces, boards, tabletops and effects are hand-built SVG, CSS and Web Animations in [`docs/art/art.js`](docs/art/art.js), so they stay crisp at any size. The free default set is **Fogline Standard**: all 9 piece types for both sides, plus a fogged back for hidden pieces, on the **Slate Table** board ([sheet](docs/art/base-pieces.png)).

Cosmetics are **decorative only and have zero gameplay effect**. The game contract never reads the cosmetics contract. All 22 items are listed onchain in [FoglineCosmetics on Base Sepolia](https://sepolia.basescan.org/address/0x2839c9c57DA7cF7Ce492E8bE87B72a798641c1A7). Prices are in valueless test fUSD. Metadata is at `https://tapelog-journal.github.io/fogline/cosmetics/{id}.json`, with the id as 64-character hex, and images are at `cosmetics/img/<id>.png`. The full list is in [`docs/cosmetics/catalog.json`](docs/cosmetics/catalog.json).

| # | Item | Type | Rarity | Price (fUSD) | Supply |
|---|---|---|---|---|---|
| 1 | Tape Neon pieces | Piece skin | Common | 2 | ∞ |
| 2 | Candle Glow pieces | Piece skin | Rare | 3 | 500 |
| 5 | Neon Circuit | Piece skin | Rare | 5 | ∞ |
| 6 | Obsidian & Gold | Piece skin | Legendary | 20 | 100 |
| 7 | Paper Origami | Piece skin | Rare | 5 | ∞ |
| 8 | Frost Glass | Piece skin | Epic | 10 | 300 |
| 3 | Midnight Fog board | Tabletop | Common | 1 | ∞ |
| 4 | Paper Ledger board | Tabletop | Common | 1 | ∞ |
| 9 | War-Room Oak | Tabletop | Rare | 6 | ∞ |
| 10 | Deep-Space Bridge | Tabletop | Epic | 12 | 300 |
| 11 | Misty Marsh at Dawn | Tabletop | Rare | 6 | ∞ |
| 12 | Retro Arcade CRT | Tabletop | Epic | 12 | 300 |
| 13 | Capture Burst | Effect | Rare | 4 | ∞ |
| 14 | Reveal Flip & Glow | Effect | Common | 2 | ∞ |
| 15 | Mine Blast | Effect | Rare | 4 | ∞ |
| 16 | Beacon Victory | Effect | Legendary | 15 | 100 |
| 17 | Ember Trail | Piece trail | Rare | 3 | ∞ |
| 18 | Comet Trail | Piece trail | Epic | 6 | ∞ |
| 19 | Ink Fog | Fog style | Common | 2 | ∞ |
| 20 | Aurora Fog | Fog style | Epic | 6 | ∞ |
| 21 | Gilded Victory Banner | Victory banner | Rare | 4 | ∞ |
| 22 | Tape Victory Banner | Victory banner | Common | 2 | ∞ |

**Previewing in the viewer.**
- **Try anything:** open the Cosmetics panel and click any item to try it on the board and in the match replay. Press **Play replay** to watch effects fire on real onchain clashes.
- **Auto-apply what a wallet owns:** connect a wallet or paste an address. The viewer reads `balanceOfBatch` from the cosmetics contract (read-only, no signing) and applies the best item owned in each category, plus all owned effects.
- **Example:** [this demo bot wallet](https://tapelog-journal.github.io/fogline/?owner=0x9b2B2f1A26123206f90e7095a7311a6dD0Fab874) bought items #6, #10, #16 and #20 on testnet.
- **URL parameters:** `?skin=6&table=10&fog=20&trail=18&banner=21&fx=13,14,15,16` previews a look directly.

**Contract slots.** The contract has two equip slots. Skins, trails and fog styles use `PieceSkin`. Tabletops, effects and banners use `BoardTheme`. The viewer groups items by the `Category` attribute in the metadata.

**Rendering.** To re-render item images, the contact sheet and effect clips, serve `docs/` locally and run `node tools/render/render.mjs`. This needs puppeteer-core and local Chrome. Item metadata is generated with `node tools/render/metadata.mjs`.

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
| `docs/` | Static match viewer (replay files or live RPC), served by GitHub Pages, and cosmetic metadata |

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
