# Fogline remote MCP server

A remote MCP server (Streamable HTTP at `/mcp`, legacy SSE at `/sse`) that lets ChatGPT, Claude and other assistants play [Fogline](../README.md) on **Base Sepolia testnet**. It runs on the Cloudflare Workers free tier with Durable Objects.

Live: `https://fogline-mcp.tapelog.workers.dev/mcp` · plain HTTP API: `/api/<action>` (GET or POST, see [`skill.md`](skill.md), served at `/skill.md`) · health: `/health`

> Game for entertainment. Testnet only. Not investment advice. Real-money wagering is disabled.

## Design

| Piece | What it does |
|---|---|
| `src/index.ts` | HTTP routes. `/mcp` is stateless Streamable HTTP with JSON responses (MCP SDK `WebStandardStreamableHTTPServerTransport`). `/sse` + `/messages` are the legacy SSE transport. Refuses any `CHAIN_ID` other than 84532 |
| `src/api.ts` | Plain HTTP JSON/text API that mirrors the tools (GET + POST), with crawler refusal, robots.txt and idempotency (`ply` on moves) |
| `skill.md`, `llms.txt` | Agent instructions, served by the Worker and mirrored in `docs/` for GitHub Pages |
| `src/tools.ts` | Tool definitions and descriptions, server `instructions`, plus read-only `search`/`fetch` |
| `src/player.ts` | `Player` Durable Object, one per session. Holds that player's throwaway key and the army salts for each match, signs its transactions (with serialized nonces), auto-reveals defenders, auto-verifies wins, and waits for the house bot's reply |
| `src/house.ts` | `House` Durable Object (singleton). The TapeLog house bot joins matches created against it and plays them with the baseline bot (`agent/src/bot.ts`), driven by Durable Object alarms. It claims timeouts if a player walks away. At most 12 concurrent matches |
| `src/funder.ts` | `Funder` Durable Object (singleton). Grants test ETH to new players with rate limits per session, per hashed IP and per day, and keeps a balance floor for the house |
| `src/sse.ts` | `SseSession` Durable Object for the legacy SSE transport |
| `test/e2e.mjs` | End-to-end test with the official MCP SDK client against the live URL |

Funding policy (see `src/env.ts`):

- 0.0001 ETH per new session. A full match costs a player about 0.00002 ETH of gas.
- Players mint their own 1000 fUSD from the public test faucet.
- Limits: 10 new funded sessions per IP per day and 40 per day overall.
- Top-ups of 0.00005 ETH only when a wallet is below 0.00003 ETH: 2 per session and 40 overall per day.
- The funder stops granting below 0.001 ETH so the house bot keeps gas.

## Board pictures, history and cosmetics

- `GET /api/match/<id>/board.png`: PNG of the board (spectator view: hidden pieces stay hidden). Add `view=<token>` (included in every player's `board_image_url`) for that player's own view, with their ranks. `t=` is only a cache buster.
- Every board response includes `board_image_url` and `board_image_markdown`. MCP tools also return the PNG as an image content block. `board_md` is still there as a text fallback.
- The picture uses each player's onchain cosmetics (owned or equipped skins, tabletops, fog styles, trails, effects and banners) and highlights the last two moves. It is rendered with resvg (WebAssembly) in the `Renderer` Durable Object and cached by scene hash.
- `GET /api/match/<id>/history`: the full public move history, rebuilt from onchain events in the viewer's replay format. The viewer uses it for `?game=…&match=…` links.
- `cosmetics` and `buy-cosmetic&item=ID` (API), or `fogline_cosmetics` and `fogline_buy_cosmetic` (MCP): decorative items paid for with valueless test fUSD.
- Tests: `npm test` (renderer unit tests), `node test/history-check.mjs 10 15`, `node test/image-e2e.mjs`.

## Browser play

`docs/play.html` (https://tapelog-journal.github.io/fogline/play.html) is a no-AI human client. It uses the same HTTP API. It creates a session with `new-player?client=browser` (same funding caps per IP and per day as agents) and keeps the session only in `localStorage`; requests are `text/plain` POSTs, so the session never goes into a URL. It places the army client-side and sends it with `set-army`, moves by clicking `moves`, and polls `state` while waiting. Invites are `play.html?join=MATCH`. The board comes from the response's `view` field, which is fog-of-war filtered on the server: hidden ranks are `null`.

## Ladder

The `Ladder` Durable Object (`src/ladder.ts`, Elo math in `src/elo.ts`) keeps a public Elo ladder. Everyone starts at 1200, K is 40 for a player's first 10 games and 24 after that. Results never come from clients: `check(id)` reads `getMatch` onchain and rates a match once, only when it is Settled with a real ending (Beacon captured, resign, timeout, max-ply draw, illegal reveal, winner unverified). An alarm scans every match id in order and re-checks unsettled ones, and Player/House also call `check` right after a settle so ratings update immediately. Players can set an optional handle (`new-player?name=` or `set-name`). The client kind is self-reported: `client=browser|mcp|skill`, otherwise `api`; the house bot is `house`. `GET /api/ladder` (JSON or `format=md`), MCP tool `fogline_ladder`, page `docs/ladder.html`.

## House bot levels

`agent/src/levels.ts` adds difficulty levels on top of the baseline bot (`agent/src/bot.ts`). Pick one with `play-bot?level=`, the MCP `fogline_play_bot` `level` argument, or the Play page selector; the House DO stores it per match.

- **easy:** mostly random legal moves and a fully random army (it still takes a revealed Beacon next to it).
- **normal:** the baseline heuristic bot (default).
- **hard:** probabilistic inference over hidden ranks. For every live hidden enemy piece it builds a rank distribution that matches the remaining army composition (composition minus ranks the chain revealed) and the onchain `moved` flag (a piece that moved is never a Beacon or Mine), with a prior that unmoved back-row pieces are more likely the Beacon or Mines, solved with iterative proportional fitting. Moves are scored by the expected material swing of attacks, the expected loss from being attacked next turn, and pressure toward the squares most likely to hide the Beacon. It also defends its own Beacon and uses a structured army (Beacon off the edge of the back row, a Mine in front and one beside it). It only uses public information.

Offline self-play (`node test/levels-sim.mjs 200`): hard beats normal about 79%, hard beats easy about 99%, normal beats easy about 90%. The ladder rates the bot separately per level (`TapeLog bot (Easy|Normal|Hard)`).

## Cosmetics shop

`docs/shop.html` (https://tapelog-journal.github.io/fogline/shop.html) lists all 22 items by category with owned/equipped badges. Selecting one loads `GET /api/shop/preview.png?item=ID[&match=N]` (`src/shop.ts`): the server renders a real recent match in spectator view (fog of war intact) with that item applied to both armies, through the same Renderer DO as the board pictures (`fixedLooks` skips the owners' looks). Trails, effects and banners only show on a move, a capture or a win, so the preview stages a sample moment on that board. Buying uses `buy-cosmetic` with test fUSD; `equip-cosmetic` (new; MCP `fogline_equip_cosmetic`) equips any owned item in its slot or clears a slot. The page uses the same localStorage session as the Play page.

## Tournaments

The `Tourney` Durable Object (`src/tourney.ts`, pure bracket logic in `src/tourney-core.ts`) runs free single-elimination tournaments on an automatic schedule (UTC-aligned, so they don't shift with daylight saving):

- **Fogline Cup** every 4 hours at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC (8 PM, 12 AM, 4 AM, 8 AM, 12 PM, 4 PM US Eastern in summer time). 8 players, 60-second turns (contract minimum), 15-minute round cap, so a cup is over in about an hour. Sign-ups close 5 minutes before the start. Prizes: Tape Victory Banner + 100 test fUSD, runner-up 50 test fUSD.
- **Sunday Major** every Sunday 18:00 UTC: 16 players, 2-minute turns, 25-minute round cap. Prizes: Gilded Victory Banner + 250 test fUSD, runner-up Tape Victory Banner + 100 test fUSD.
- **Sign-up:** `join-cup` (session; optional `name`) joins the next cup in one call; `tournament-signup&id=major` the Major; MCP `fogline_tournament_signup` (`event: next|major`); or the bracket page `docs/tournament.html`. `tournament-withdraw` before the start.
- **Draw:** players are seeded by ladder rating and TapeLog house bots (Hard, Normal, Easy) fill the empty seats up to the next power of two; house bots never play each other (the higher level advances).
- **Exhibitions:** a cup nobody signed up for is never just cancelled. In the 00:00 and 12:00 UTC slots (and for the Major) eight TapeLog bot personas (Rewind and Overdub on Hard; Splice, Reel and Static on Normal; Hiss, Wobble and Leader on Easy; each with its own throwaway testnet wallet and unlimited-supply cosmetics) play the bracket out onchain. Exhibition games stop at 100 plies or the round cap, and the side with fewer pieces resigns, so every game ends onchain. Exhibitions are labelled, never rated (the ladder skips persona matches), award no prizes, and the final gets a win clip and share card. Other empty cups are marked skipped.
- **Gas budget:** a full 8-bot exhibition is 7 onchain games. Personas get small capped top-ups from the funder (`fundBot`: 0.00008 ETH below 0.00004, at most 24 per day), and exhibitions pause entirely when the funder is below 0.003 ETH, which keeps player grants and the house bot funded.
- **Matches:** for each pairing the server creates a normal onchain match from the host player's own session (vs the house bot with `play-bot`, or reserved for the other player, who then joins automatically). An alarm every 20 s follows each match onchain: defender reveals, winner army checks, expired-timer claims (the house wallet pays testnet gas). Results come from the chain only.
- **API:** `GET /api/tournament` returns `next`, `current`, `major`, `recent` (with `clip` / `card` for each final) and `tournament` (`?id=` for a specific one). MCP `fogline_tournament`.
- **Operator:** `POST /admin/practice-tournament` needs the `ADMIN_TOKEN` secret in the `x-admin-token` header (never in a URL); `{"exhibitionCup":true}` schedules an extra cup now.

## Highlight clips

`src/clips.ts` finds the highlights of a match from its public onchain history (`history.ts` snapshots): every capture, Mine blast (an attacker lost to a Mine), Ghost ambush on a Warden, and the winning moment (a Beacon capture, or the resign/timeout that ended it). For each one the Renderer DO (sharded by match) rasterizes the spectator view of the lead-up moves plus the moment itself with resvg (players' equipped cosmetics, last-move arrows and capture effects included), and encodes a looping GIF with gifenc (MIT; one shared palette, unchanged pixels transparent, about 80-100 KB for 5-7 frames). It also renders a 1200x630 share card. Finished clips are cached in DO storage (newest 60).

- `GET /clip/N/STEP`: share page with `og:image` / `twitter:card=summary_large_image` tags pointing at the card, the GIF, Play and replay links. `/clip/N/win` and `/clip/N/last` redirect to the step.
- `GET /clip/N/STEP.gif`, `GET /clip/N/STEP/card.png`, `GET /api/match/N/highlights` (JSON), MCP `fogline_highlights`.
- Auto-generation: the ladder pre-builds the win clip when it rates a match; `move`/`state` replies add `next.clip` / `highlight_clip` after a capture or at game end; the Play page shows a "🎬 Share" link and the ladder's recent matches link their clips.

## Deploy

```bash
cd remote-mcp && npm install
# secrets are never committed; generate throwaway testnet keys and store them outside the repo (chmod 600)
npx wrangler secret put FUNDER_KEY   # testnet key that funds players, holds ~0.01 Base Sepolia ETH
npx wrangler secret put HOUSE_KEY    # testnet key for the house bot (topped up by the funder)
npx wrangler secret put IP_SALT      # random hex, used to hash IPs for rate limiting
npx wrangler deploy
```

## Test

```bash
node test/e2e.mjs https://fogline-mcp.tapelog.workers.dev/mcp --moves 8
node test/e2e.mjs https://fogline-mcp.tapelog.workers.dev/sse --sse --moves 3
node test/skill-e2e.mjs   # follows skill.md with plain GETs and plays a full match vs the bot
# if your network intercepts *.workers.dev, pin the real IP: FOGLINE_RESOLVE_IP=<ip from DoH> node test/e2e.mjs ...
```

### Board pictures in ChatGPT

ChatGPT only displays a markdown image whose exact URL the user typed in the chat, or one OpenAI's own crawler has already seen. Picture URLs made up per turn by a server show as a broken image. The workaround is board links: `GET /chatgpt` returns a prompt with a fresh name and 40 links, `/v/NAME/1.png` … `/40.png`. The user pastes that prompt, and the agent calls `new-player?board=NAME` (or `link-board`). After that, each new board picture is bound to the next link and returned as `board_image_url`, with `board_image_user_typed: true`. Pictures are 640px palette PNGs, about 80–90 KB, and are rendered before the response returns. Other picture URLs use a path style: `/img/MATCH/PLY-PHASE/(VIEWTOKEN|spectator).png`. GET and HEAD are supported, with Content-Length, CORS `*` and no redirects.
