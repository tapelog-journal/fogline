---
name: fogline
description: Play Fogline, an onchain hidden-army strategy game on Base Sepolia testnet, against the TapeLog bot or a friend using plain HTTP GET/POST calls. No install, wallet, key or connector needed. Game for entertainment. Testnet only. Not investment advice.
---

# Fogline: play with one link

Fogline is an original strategy game by TapeLog that runs on the Base Sepolia **testnet**. Each side has 16 secret pieces. Only hashes are onchain until pieces clash, and every move is a real testnet transaction. The server keeps a throwaway testnet wallet for the player, so you only make HTTP calls.

API base: `https://fogline-mcp.tapelog.workers.dev/api`

- Every action works as **GET with query params** or **POST with a JSON body**.
- The response is always HTTP 200 with JSON: `ok`, `text`, `board`, `legalMoves`, `moveUrls`, `next`, `watch` and `error` when `ok` is false.
- Add `&format=text` to any URL to get plain text instead of JSON.
- Responses include ready-made `next` and `moveUrls` links, so you can just open the next link.
- If your fetch tool can only open URLs that already appeared in the conversation or in earlier results, don't build URLs yourself. Open the exact links from `next` and `moveUrls`. With `&format=text` they're listed one per line.

## Rules (short)

- **Board:** 8x8. A square is `row*8+col`, with row 0 at the bottom. Squares 26 and 37 are fog banks: they're impassable.
- **Your side:** you are side A (squares 0-15, moving UP) when you create a match or play the bot. A friend who joins is side B (48-63, moving DOWN).
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
   `https://fogline-mcp.tapelog.workers.dev/api/new-player`
2. Start a free match vs the bot. Returns `matchId`, and the bot joins automatically.
   `https://fogline-mcp.tapelog.workers.dev/api/play-bot?session=SESSION`
3. Place a sensible secret army. Returns the board and your legal moves.
   `https://fogline-mcp.tapelog.workers.dev/api/auto-army?session=SESSION&match=MATCH`
4. Move. Use a link from `moveUrls`, or build one with the current `ply` from the last response:
   `https://fogline-mcp.tapelog.workers.dev/api/move?session=SESSION&match=MATCH&from=9&to=17&ply=0`
   The bot replies inside the same call (about 5-10s). The response tells you what happened (moves, combats with ranks revealed) and gives the new board, `ply` and `moveUrls`.
5. Repeat step 4 until `phase` is `Settled`. Reveals and the end-of-game army check happen automatically.
6. To look again without moving:
   `https://fogline-mcp.tapelog.workers.dev/api/state?session=SESSION&match=MATCH`
7. Share the `watch` link so the human can watch the board live:
   `https://tapelog-journal.github.io/fogline/?game=0x059db9310c1DFB3009DAd13d043589DDBe75C874&match=MATCH`

Optional parameters:

- `play-bot`: `stake` (0-100, in valueless test fUSD) and `timeout` (60-3600 seconds per turn).
- `set-army` takes 16 comma-separated ranks in starting-square order instead of auto-army, for example:
  `.../api/set-army?session=SESSION&match=MATCH&ranks=Mine,Beacon,Mine,Guard,Knight,Sapper,Guard,Captain,Scout,Ghost,Scout,Warden,Scout,Knight,Sapper,Guard`
  Side A's order is squares 0..15 (back row first). Side B's order is 48..63 (front row first).
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
curl -s -X POST $B/move      -H 'content-type: application/json' -d '{"session":"SESSION","match":MATCH,"from":9,"to":17,"ply":0}'
curl -s "$B/state?session=SESSION&match=MATCH&format=text"
```

## Reading the board

```
56| ?? ?? ?? ?? ?? ?? ?? ??     row 7 (squares 56-63)
48| ?? ?? ?? -K ?? ?? ?? ??     -K = revealed enemy Knight on 51
40| .. .. .. .. .. .. .. ..
32| .. +S .. .. .. ~~ .. ..     ~~ = fog bank (37)
...
00| +K +S +U +M +B +M +G +U     row 0 (squares 0-7): your pieces
sq| c0 c1 c2 c3 c4 c5 c6 c7     square = row start at left + column
```

- `+X` is your piece, where X is the rank letter: B Beacon, G Ghost, S Scout, P Sapper, U Guard, K Knight, C Captain, W Warden, M Mine.
- `??` is a hidden enemy piece, `-X` is a revealed enemy piece and `..` is an empty square.
- The number at the left is the first square of that row.
- `legalMoves` entries look like `from->to`, with an `x` suffix when the move is an attack.

## Strategy tips

- Probe hidden pieces with cheap Scouts and Guards before risking the Warden or Captain.
- Enemy pieces that have never moved (`?` rather than `?moved` in `enemyPieces`) may be Mines or the Beacon. Send a Sapper at them, and hunt the Beacon on the enemy back row.
- Don't move the pieces next to or in front of your Beacon. Enemy Scouts slide up to 3 squares through any opened lane.
- Keep the Ghost back as an answer to the enemy Warden.
- Don't walk next to a revealed enemy piece that outranks yours.
- Long Scout moves reveal the Scout. Use them to scout, not to defend.

## Etiquette and safety

- Ask the human before each move if they want to choose ("I suggest 12->20. OK?"). Otherwise play on their behalf and summarize each turn.
- Use one session per human. Don't create extra players to get more test ETH: funding is rate-limited.
- Every `move` URL carries `ply`. If you open the same link twice, the second call won't move, and it returns `stale: true` with the current board.
- If you get `ok: false`, read `error`. It explains what to do (for example, it isn't your turn yet).
- Resign only when the human asks.
- Testnet only: stakes use a valueless test token and nothing here has monetary value.

Game for entertainment. Testnet only. Not investment advice.
