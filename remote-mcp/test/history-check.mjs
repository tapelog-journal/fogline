// Rebuilds match histories from chain events (same code as /api/match/<id>/history) and sanity-checks them.
// Usage: node test/history-check.mjs 10 15
import { build } from "esbuild";
await build({ entryPoints: { history: "src/history.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error", external: ["viem", "viem/*"] });
const H = await import("./.build/history.js");
const game = "0x059db9310c1DFB3009DAd13d043589DDBe75C874", rpc = "https://sepolia.base.org,https://base-sepolia-rpc.publicnode.com";
const created = await H.scanCreated(game, H.GAME_DEPLOY_BLOCK, await H.head());
console.log("matches indexed:", Object.keys(created).length);
for (const id of process.argv.slice(2)) {
  const h = await H.loadHistory(rpc, game, BigInt(id), BigInt(created[id]));
  const last = h.snapshots.at(-1).state;
  console.log(`#${id}: ${h.snapshots.length} steps, plies ${h.plies}, done ${h.done}, winner ${h.winner} ${h.reason}`);
  console.log("  first:", h.snapshots.slice(0, 5).map((s) => s.log).join(" | "));
  console.log("  last:", h.snapshots.slice(-4).map((s) => s.log).join(" | "));
  // the event-rebuilt board before the final chain overwrite must match the chain board
  const rebuilt = H.buildSnapshots(BigInt(id), await H.chunkedLogs(game, BigInt(created[id]), BigInt(h.toBlock), [null, `0x${BigInt(id).toString(16).padStart(64, "0")}`]), game).snapshots.at(-1).state;
  const diff = rebuilt.board.map((v, i) => (Number(v) !== Number(last.board[i]) ? i : -1)).filter((i) => i >= 0);
  console.log("  rebuilt board == chain board:", diff.length === 0 ? "yes" : `NO, squares ${diff}`);
}
