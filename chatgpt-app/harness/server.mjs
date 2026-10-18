// Local test harness that emulates a ChatGPT / MCP Apps host for the Fogline board widget.
// It is NOT ChatGPT: it loads the widget from the MCP server (resources/read), answers ui/initialize,
// sends ui/notifications/tool-input + tool-result, and proxies the widget's tools/call to the real MCP server.
//   MCP_URL=https://fogline-mcp.tapelog.workers.dev/mcp [RESOLVE=host:443:ip] node chatgpt-app/harness/server.mjs
//   open http://localhost:8787/?session=fl_...&matchId=12      (or ?new=1 to start a fresh match vs the bot)
//   add &mode=openai to test the window.openai compatibility path instead of the MCP Apps bridge.
// RESOLVE pins DNS for curl (--resolve) when the local network rewrites *.workers.dev. Testnet only.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.MCP_URL || "https://fogline-mcp.tapelog.workers.dev/mcp";
const PORT = Number(process.env.PORT || 8787);

function forward(body) {
  return new Promise((resolve, reject) => {
    const args = ["-sS", "-m", "170", "-X", "POST", MCP_URL, "-H", "content-type: application/json", "-H", "accept: application/json, text/event-stream", "--data-binary", "@-"];
    if (process.env.RESOLVE) args.unshift("--resolve", process.env.RESOLVE);
    const p = execFile("curl", args, { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)));
    p.stdin.end(body);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/mcp-proxy") {
    let body = ""; for await (const c of req) body += c;
    try { const out = await forward(body); res.writeHead(200, { "content-type": "application/json" }); res.end(out); }
    catch (e) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: String(e) } })); }
    return;
  }
  if (url.pathname === "/" || url.pathname === "/host.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(here, "host.html"), "utf8"));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, () => console.log(`harness on http://localhost:${PORT}  ->  ${MCP_URL}`));
