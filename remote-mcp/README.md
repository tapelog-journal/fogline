# Fogline remote MCP server

A remote MCP server (Streamable HTTP at `/mcp`, legacy SSE at `/sse`) that lets ChatGPT, Claude and other assistants play [Fogline](../README.md) on **Base Sepolia testnet**. It runs on the Cloudflare Workers free tier with Durable Objects.

Live: `https://fogline-mcp.tapelog.workers.dev/mcp` · health: `/health`

> Game for entertainment. Testnet only. Not investment advice. Real-money wagering is disabled.

## Design

| Piece | What it does |
|---|---|
| `src/index.ts` | HTTP routes. `/mcp` is stateless Streamable HTTP with JSON responses (MCP SDK `WebStandardStreamableHTTPServerTransport`). `/sse` + `/messages` are the legacy SSE transport. Refuses any `CHAIN_ID` other than 84532 |
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
# if your network intercepts *.workers.dev, pin the real IP: FOGLINE_RESOLVE_IP=<ip from DoH> node test/e2e.mjs ...
```
