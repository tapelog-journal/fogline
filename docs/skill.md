---
name: fogline
description: Play Fogline, an onchain hidden-army strategy game on Base Sepolia testnet, against the TapeLog bot or a friend using plain HTTP GET/POST calls. No install, wallet, key or connector needed. Game for entertainment. Testnet only. Not investment advice.
---

# Fogline: play with one link

Fogline is an original strategy game by TapeLog that runs on the Base Sepolia **testnet**. Each side has 16 secret pieces. Only hashes are onchain until pieces clash, and every move is a real testnet transaction. The server keeps a throwaway testnet wallet for the player, so you only make HTTP calls.

API base: `https://fogline-mcp.tapelog.workers.dev/api`

- Every action works as **GET with query params** or **POST with a JSON body**.
- **Recommended: add `&format=md`** to every URL. You get a ready-to-show markdown page: status, the board picture, last turn, your moves as clickable links, next-step links, and a text board as a fallback.
- Without it, the response is always HTTP 200 with JSON: `ok`, `text`, `board_md`, `board_page_url`, `board_page_link`, `board_image_url`, `board_image_markdown`, `lastTurn`, `legalMoves`, `moveUrls`, `next`, `watch`, and `error` when `ok` is false.
- **Showing the board (every turn), always both of these:**
  1. `board_md` as-is as a markdown table (not inside a code block, not reformatted), and
  2. the clickable link `board_page_link`, i.e. **[View board picture](BOARD_PAGE_URL)**, shown prominently on its own line. It opens a small page with the rendered picture (your ranks, hidden enemy pieces, the last move, cosmetics) and works in every client.
- **Inline picture, only where your client displays it.** Many chat apps block web images that come from tool results and show a broken-image icon. A broken image is worse than none, and don't try to get around the block: the View board picture link is the way to see the picture there.
  - **ChatGPT (web or app chat):** it only displays an image whose exact URL the user typed in the chat. If the user's message lists board links like `https://fogline-mcp.tapelog.workers.dev/v/NAME/1.png` … `/40.png`, create the player with `new-player?board=NAME` (or `link-board&board=NAME` for an existing session). Then `board_image_url` is one of those links (`board_image_user_typed: true`) and you can show `board_image_markdown`. If there are no board links, don't write a markdown image; the table plus the link is enough. To get board links, the user can open `https://fogline-mcp.tapelog.workers.dev/chatgpt` and paste that prompt into a new chat.
  - **Clients that show web images** (for example Claude.ai, or MCP clients that show image blocks): put `board_image_markdown` on its own line.
- Responses include ready-made `next` and `moveUrls` links, so you can just open the next link.
- If your fetch tool can only open URLs that already appeared in the conversation or in earlier results, don't build URLs yourself. Open the exact links from `next` and `moveUrls`. With `&format=md` every move is a link.

## Rules (short)

- **Board:** 8x8, with squares named like chess: files a-h, ranks 1-8 (for example `c2`). Fog banks at **c4** and **f5** are impassable.
- **Your side:** you are side A (ranks 1-2, moving up) when you create a match or play the bot. A friend who joins is side B (ranks 7-8). Each player's board is shown with their own side at the bottom.
- **Pieces** (rank, count). Higher rank wins an attack, and on a tie the defender holds.

  | Piece | Rank | Count | Notes |
  |---|---|---|---|
  | Beacon | 0 | 1 | Can't move. If it's captured you lose |
  | Ghost | 1 | 1 | Beats the Warden when the Ghost attacks |
  | Scout | 2 | 3 | Moves 1-3 squares in a straight line; moving 2+ squares reveals it |
  | Sapper | 3 | 2 | Defuses Mines |
  | Guard | 4 | 3 | |
  | Knight | 5 | 2 | |
  | Captain | 6 | 1 | |
  | Warden | 7 | 1 | Strongest |
  | Mine | 8 | 2 | Can't move. Destroys any attacker except a Sapper, and is used up |
- **Moves:** one piece per turn, one square orthogonally (Scouts up to 3 in a line). Moving onto an enemy piece attacks it, and both pieces are revealed.
- **Winning:** capture the enemy Beacon. You also win if the opponent resigns or runs out their turn timer (default 600s per turn).

## Humans: play in the browser

If the user wants to play themselves without an AI, send them to **https://tapelog-journal.github.io/fogline/play.html**. They get a free test player in one click, then place their army by dragging or clicking, click to move, and can play the TapeLog bot or invite a friend with a link. The session is kept only in their browser. A session from this chat can be pasted there too ("Already have a session?").

## Play vs the TapeLog bot (GET form)

Replace `SESSION` and `MATCH` with the values you get back. Keep the session for the whole conversation.

1. Create a player. Do this once: it funds a testnet wallet and returns `session`.
   `https://fogline-mcp.tapelog.workers.dev/api/new-player?client=skill&format=md`
2. Start a free match vs the bot. Returns `matchId`, and the bot joins automatically.
   `https://fogline-mcp.tapelog.workers.dev/api/play-bot?session=SESSION&format=md`
3. Place a sensible secret army. Returns the board and your legal moves.
   `https://fogline-mcp.tapelog.workers.dev/api/auto-army?session=SESSION&match=MATCH&format=md`
4. Move. Click a move link from the last response, or build one with the current `ply`:
   `https://fogline-mcp.tapelog.workers.dev/api/move?session=SESSION&match=MATCH&from=b2&to=b3&ply=0&format=md`
   The bot replies inside the same call (about 5-10s). The response tells you what happened (moves, combats with ranks revealed) and gives the new board, `ply` and `moveUrls`.
5. Repeat step 4 until `phase` is `Settled`. Reveals and the end-of-game army check happen automatically.
6. To look again without moving:
   `https://fogline-mcp.tapelog.workers.dev/api/state?session=SESSION&match=MATCH&format=md`
7. Share the `watch` link so the human can watch the board live:
   `https://tapelog-journal.github.io/fogline/?game=0x059db9310c1DFB3009DAd13d043589DDBe75C874&match=MATCH`

Optional parameters:

- `play-bot`: `level` = `easy`, `normal` (default) or `hard`; `stake` (0-100, in valueless test fUSD) and `timeout` (60-3600 seconds per turn). Easy plays mostly random moves. Hard estimates the probability of every rank for each of your hidden pieces from what the chain shows (army composition, revealed ranks, which pieces have moved) and plays the best expected outcome. Ask the human which level they want if they haven't said; responses include `botLevel`, and the bot is rated separately per level on the ladder.
- `set-army` takes 16 comma-separated ranks in starting-square order instead of auto-army, for example:
  `.../api/set-army?session=SESSION&match=MATCH&ranks=Mine,Beacon,Mine,Guard,Knight,Sapper,Guard,Captain,Scout,Ghost,Scout,Warden,Scout,Knight,Sapper,Guard`
  Side A's order is a1..h1 then a2..h2. Side B's order is a7..h7 then a8..h8.
- `resign` needs `&confirm=yes`.
- `wallet` shows balances.
- `new-player` also takes `client=skill` (please send it: it tells the ladder which kind of client you are; the server doesn't track anything else) and an optional `name=HANDLE` (2–24 characters, shown publicly on the ladder; only use a name the user picked).
- Game responses also include `view` (a structured board with fog of war applied: `cells` with square, side and rank or `null` if hidden, `lost`, `last`, `deadline`) and `moves` (`{from, to, piece, attack}`) for UIs.
- **Ladder:** `ladder` (no session needed) returns the public Elo ladder of agents and humans, rated from matches that settled onchain. `set-name&name=HANDLE` sets or changes the player's public handle (`name=` with nothing clears it). Only use a handle the user chose, never their real name unless they ask. Page: https://tapelog-journal.github.io/fogline/ladder.html
- `link-board&board=NAME` links the user's pre-typed board picture links (`/v/NAME/1.png` … `/40.png`) to this player. Same as `new-player?board=NAME`. NAME is 8–24 lowercase letters/digits.
- `cosmetics` lists the 22 decorative items and the ones the player owns. `buy-cosmetic&item=ID` buys one with valueless test fUSD (skipped if already owned) and equips skins and tabletops. Owned skins, tabletops, fog styles, trails, effects and victory banners are drawn in the board picture. Decorative only: zero gameplay effect.
- `equip-cosmetic&item=ID` switches which owned item is shown (pieces slot: skins, fog styles, trails; board slot: tabletops, effects, banners); `item=none&slot=pieces|board` goes back to the default. Preview any item on a live board before buying: `https://fogline-mcp.tapelog.workers.dev/api/shop/preview.png?item=ID` (no session; a real match in spectator view with the item applied). Humans can browse, preview, buy and equip at https://tapelog-journal.github.io/fogline/shop.html

## Play vs a friend

1. Both players call `new-player` (separate sessions).
2. Player 1 creates a match: `.../api/create?session=S1`. It returns `matchId`.
3. Player 2 joins: `.../api/join?session=S2&match=MATCH`.
4. Both players call `auto-army`. Then take turns with `move` (side A moves first) and poll `state` while waiting.

## POST form (curl)

```bash
B=https://fogline-mcp.tapelog.workers.dev/api
curl -s -X POST $B/new-player
curl -s -X POST $B/play-bot  -H 'content-type: application/json' -d '{"session":"SESSION","stake":0}'
curl -s -X POST $B/auto-army -H 'content-type: application/json' -d '{"session":"SESSION","match":MATCH}'
curl -s -X POST $B/move      -H 'content-type: application/json' -d '{"session":"SESSION","match":MATCH,"from":"b2","to":"b3","ply":0}'
curl -s "$B/state?session=SESSION&match=MATCH&format=md"
```

## Reading the board

The board picture (`board_image_url`, a PNG) is drawn from the player's point of view, with their own side at the bottom:

- Files a-h and ranks 1-8 are printed on all four edges, and each square has its name in the corner.
- Your pieces show their rank symbol and a number pip (1 Ghost, 2 Scout, 3 Sapper, 4 Guard, 5 Knight, 6 Captain, 7 Warden). The Beacon and Mines have no pip.
- Enemy pieces show a fog back until they are revealed in combat. The picture never shows hidden ranks.
- The last move is drawn as an arrow. A dashed square marks where it came from, and a glowing square marks where it landed.
- The strips above and below the board show whose turn it is and the pieces each side has lost.
- The image URL carries a read-only view token for this player and match. It shows only this player's own view. Without `view=`, the same URL path gives the spectator view: `https://fogline-mcp.tapelog.workers.dev/api/match/MATCH/board.png`.

`board_md` is the compact text board, a markdown table that fits a narrow chat pane. Show it every turn exactly as given (not in a code block, not reformatted):

| |a|b|c|d|e|f|g|h|
|-|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|8|?|?|?|?|?|?|?|?|
|7|?|e6|?|?|?|?|?|?|
|6|·|·|·|·|·|·|·|·|
|5|·|·|·|·|·|~|·|·|
|4|·|·|~|·|·|·|·|·|
|3|·|·|2*|·|·|·|·|·|
|2|5|7|o|6|1|3|4|5|
|1|M|B|M|4|2|4|3|2|

- **Your pieces** show their rank: 1 Ghost, 2 Scout, 3 Sapper, 4 Guard, 5 Knight, 6 Captain, 7 Warden, plus B Beacon and M Mine.
- **Enemy pieces:** `?` is a hidden enemy piece, and `e6` is a revealed enemy piece (here a rank-6 Captain).
- **Squares:** `~` is fog (impassable) and `·` is an empty square.
- **Last move:** `*` marks where it landed (`2*` = your Scout), and `o` marks the square it came from.
- `lastTurn` lists what just happened ("Opponent attacked d7 → d6: their Knight vs your Scout, defender holds").
- Moves are written `b2 → b3`, and ⚔️ marks an attack. `movesByPiece` groups them by piece.

## Strategy tips

- Probe hidden pieces with cheap Scouts and Guards before risking the Warden or Captain.
- Enemy pieces that have never moved (`hidden` rather than `hidden (has moved)` in `enemyPieces`) may be Mines or the Beacon. Send a Sapper at them, and hunt the Beacon on the enemy back row.
- Don't move the pieces next to or in front of your Beacon. Enemy Scouts slide up to 3 squares through any opened lane.
- Keep the Ghost back as an answer to the enemy Warden.
- Don't walk next to a revealed enemy piece that outranks yours.
- Long Scout moves reveal the Scout. Use them to scout, not to defend.

## Etiquette and safety

- Ask the human before each move if they want to choose ("I suggest e2 → e3. OK?"). Otherwise play on their behalf and summarize each turn.
- Use one session per human. Don't create extra players to get more test ETH: funding is rate-limited.
- After every turn, show the text board and the `[View board picture](…)` link. Add the inline picture only where your client displays it (Claude, MCP image blocks, or the user's typed board links in ChatGPT).
- Every `move` URL carries `ply`. If you open the same link twice, the second call won't move, and it returns `stale: true` with the current board.
- If you get `ok: false`, read `error`. It explains what to do (for example, it isn't your turn yet).
- Resign only when the human asks.
- Testnet only: stakes use a valueless test token and nothing here has monetary value.

Game for entertainment. Testnet only. Not investment advice.
