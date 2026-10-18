# Fogline ChatGPT app (board inside the chat)

The Fogline remote MCP server ships an interactive board widget for ChatGPT, built on the
OpenAI Apps SDK / open MCP Apps standard. Game for entertainment. Base Sepolia testnet only. Not investment advice.

- **Widget:** `widget.html` is served as MCP resource `ui://fogline/board-v1.html` (`text/html;profile=mcp-app`).
- **Tools that show the board:** `fogline_state`, `fogline_auto_army`, `fogline_set_army`, `fogline_move` and `fogline_resign`.
  They link to the widget through `_meta.ui.resourceUri`, plus the ChatGPT alias `_meta["openai/outputTemplate"]`.
  - They return `structuredContent` with the player's fog-filtered view and legal moves.
  - The server-drawn board picture, with equipped cosmetics, rides in result `_meta["fogline/boardPng"]`, which is hidden from the model.
- **Tap to move:** tap one of your pieces, then a highlighted square. The widget calls `fogline_move` through the
  MCP Apps bridge (`tools/call`), falling back to `window.openai.callTool`. It then tells the model what happened
  through `ui/update-model-context`.
- **Read-only plans:** if the host refuses a write tool, the widget sends that one tap to the
  public Fogline HTTP API (declared in the widget CSP) and reloads itself with the read-only `fogline_state` tool.
- **Fog of war:** enemy ranks are removed on the server before anything reaches the widget.

## Add it in ChatGPT

1. Open **chatgpt.com** in a web browser. Custom MCP servers are set up on ChatGPT web, not on mobile.
2. Go to **chatgpt.com/plugins**, click **+**, then **Add custom MCP server**. Older UIs call it "Create MCP App" or
   **Settings → Apps → Create**.
3. Fill in the form:
   - **Name:** `Fogline by TapeLog`
   - **URL:** `https://fogline-mcp.tapelog.workers.dev/mcp`
   - **Authentication:** none
4. Tick **I understand and want to continue**, then click **Create**.
5. Start a new chat, type `@`, pick **Fogline by TapeLog**, and say: *Let's play Fogline against the TapeLog bot.*

After the server's tools or widget change, open the connection at chatgpt.com/plugins and click **Refresh**.

## Local test harness

`harness/` emulates an MCP Apps host. It is not ChatGPT. It loads the widget with `resources/read`, answers
`ui/initialize` and sends `tool-input` and `tool-result`. It forwards the widget's `tools/call` to a real server.

```
MCP_URL=https://fogline-mcp.tapelog.workers.dev/mcp node chatgpt-app/harness/server.mjs
# http://localhost:8787/?new=1                          fresh player + match vs the bot
# http://localhost:8787/?session=fl_...&matchId=21      existing match
# &mode=openai    window.openai compatibility path
# &mode=readonly  host refuses write tools (tests the HTTP API fallback)
```
