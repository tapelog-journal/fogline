---
name: fogline
description: Play Fogline, an onchain hidden-army strategy game on Base Sepolia testnet, against the TapeLog bot or a friend using plain HTTP GET/POST calls. No install, wallet, key or connector needed. Game for entertainment. Testnet only. Not investment advice.
---

# Fogline: play with one link

Fogline is an original strategy game by TapeLog that runs on the Base Sepolia **testnet**. Each side has 16 secret pieces. Only hashes are onchain until pieces clash, and every move is a real testnet transaction. The server keeps a throwaway testnet wallet for the player, so you only make HTTP calls.

API base: `https://fogline-mcp.tapelog.workers.dev/api`

- Every action works as **GET with query params** or **POST with a JSON body**.
- **Recommended: add `&format=md`** to every URL. You get a ready-to-show markdown page: status, board table, legend, last turn, your moves as clickable links, and next-step links.
- Without it, the response is always HTTP 200 with JSON: `ok`, `text`, `board_md`, `lastTurn`, `legalMoves`, `moveUrls`, `next`, `watch`, and `error` when `ok` is false.
- **Showing the board:** render `board_md` (or the table in the md page) as-is, as a markdown table. Don't put it inside a code block, and don't reformat it.
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

## Play vs the TapeLog bot (GET form)

Replace `SESSION` and `MATCH` with the values you get back. Keep the session for the whole conversation.

1. Create a player. Do this once: it funds a testnet wallet and returns `session`.
   `https://fogline-mcp.tapelog.workers.dev/api/new-player?format=md`
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

- `play-bot`: `stake` (0-100, in valueless test fUSD) and `timeout` (60-3600 seconds per turn).
- `set-army` takes 16 comma-separated ranks in starting-square order instead of auto-army, for example:
  `.../api/set-army?session=SESSION&match=MATCH&ranks=Mine,Beacon,Mine,Guard,Knight,Sapper,Guard,Captain,Scout,Ghost,Scout,Warden,Scout,Knight,Sapper,Guard`
  Side A's order is a1..h1 then a2..h2. Side B's order is a7..h7 then a8..h8.
- `resign` needs `&confirm=yes`.
- `wallet` shows balances.

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

`board_md` is a markdown table. Show it to the human exactly as given:

|   | a | b | c | d | e | f | g | h |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **8** | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| **7** | ❓ | ❓ | ❓ | 🔴Kn | ❓ | ❓ | ❓ | ❓ |
| **6** |   |   |   |   |   |   |   |   |
| **5** |   | 📍🔵Sc |   |   |   | 🌫️ |   |   |
| **4** |   |   | 🌫️ |   |   |   |   |   |
| **3** |   |   |   |   |   |   |   |   |
| **2** | 🔵Gu | · | 🔵Sa | 🔵Wa | 🔵Sa | 🔵Sc | 🔵Kn | 🔵Ca |
| **1** | 🔵Kn | 🔵Sc | 🔵Gu | 🔵Mi | 🔵Bc | 🔵Mi | 🔵Gh | 🔵Gu |

- 🔵 marks your pieces and 🔴 a revealed enemy piece. ❓ is a hidden enemy piece, 🌫️ is fog, and an empty cell is an empty square.
- 📍 marks where the last move landed, and · marks the square it came from.
- Abbreviations: Bc Beacon, Gh Ghost, Sc Scout, Sa Sapper, Gu Guard, Kn Knight, Ca Captain, Wa Warden, Mi Mine.
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
- Show the board table after every turn (render it, don't paste it as code).
- Every `move` URL carries `ply`. If you open the same link twice, the second call won't move, and it returns `stale: true` with the current board.
- If you get `ok: false`, read `error`. It explains what to do (for example, it isn't your turn yet).
- Resign only when the human asks.
- Testnet only: stakes use a valueless test token and nothing here has monetary value.

Game for entertainment. Testnet only. Not investment advice.
