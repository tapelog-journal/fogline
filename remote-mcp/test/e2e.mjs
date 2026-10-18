// End-to-end test of the live Fogline remote MCP server using the official MCP SDK client.
// Usage: node test/e2e.mjs [url] [--moves N] [--sse]
//   FOGLINE_RESOLVE_IP=1.2.3.4 pins the hostname to an IP (for networks that intercept *.workers.dev).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Agent, fetch as ufetch } from "undici";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "https://fogline-mcp.tapelog.workers.dev/mcp";
const moves = Number(args[args.indexOf("--moves") + 1]) || 6;
const useSse = args.includes("--sse");
const pin = process.env.FOGLINE_RESOLVE_IP;
const dispatcher = pin ? new Agent({ connect: { lookup: (_h, _o, cb) => cb(null, [{ address: pin, family: 4 }]) } }) : undefined;
const f = (u, init = {}) => ufetch(u, { ...init, dispatcher });

const client = new Client({ name: "fogline-e2e", version: "0.1.0" });
const transport = useSse ? new SSEClientTransport(new URL(url), { fetch: f, eventSourceInit: { fetch: f } }) : new StreamableHTTPClientTransport(new URL(url), { fetch: f });
await client.connect(transport);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const call = async (name, a = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: a }, undefined, { timeout: 180_000 });
  const t = r.content?.map((c) => c.text).join("\n") ?? "";
  log(`== ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${r.isError ? " ERROR" : ""}\n${t}\n`);
  if (r.isError) throw new Error(`${name} failed`);
  return t;
};

const tools = await client.listTools();
log("tools:", tools.tools.map((t) => t.name).join(", "));
if (args.includes("--list")) process.exit(0);
await call("fogline_rules");
try { await call("fogline_play_bot", { session: "fl_00000000000000000000000000000000", chainId: 1 }); } catch { log("chainId 1 correctly refused"); }
const np = await call("fogline_new_player", {});
const session = np.match(/session: (fl_[0-9a-f]{32})/)[1];
const pb = await call("fogline_play_bot", { session, stake: 0, turnTimeoutSeconds: 300 });
const matchId = Number(pb.match(/Match #(\d+)/)[1]);
let out = await call("fogline_auto_army", { session, matchId });
for (let i = 0; i < moves; i++) {
  const lines = [...out.matchAll(/^- \*\*\S+ ([a-h][1-8])\*\* → (.*)$/gm)];
  const m = lines.length ? [null, lines.flatMap((l) => l[2].split(" · ").map((t) => `${l[1]}->${t.replace("⚔️", "")}`)).join(", ")] : null;
  if (!m) {
    if (/game over|settled/i.test(out)) break;
    for (let k = 0; k < 8 && !/Your moves/.test(out); k++) { await new Promise((r) => setTimeout(r, 5000)); out = await call("fogline_state", { session, matchId }); }
    i--; if (!/Your moves/.test(out)) break; continue;
  }
  const list = m[1].split(", ").map((s) => s.split("->"));
  // prefer forward moves (side A advances up)
  list.sort((a, b) => (Number(b[1][1]) - Number(b[0][1])) - (Number(a[1][1]) - Number(a[0][1])) + (Math.random() - 0.5) * 3);
  const [from, to] = list[0];
  out = await call("fogline_move", { session, matchId, from, to });
}
await call("fogline_state", { session, matchId });
await call("fogline_wallet", { session });
await call("search", { query: `match ${matchId}` });
await call("fetch", { id: `match:${matchId}` });
console.log(JSON.stringify({ session: session.slice(0, 7) + "…", matchId }));
await client.close();
