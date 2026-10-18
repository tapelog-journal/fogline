// Offline self-play between bot levels (pure rules sim, no chain). Run: node test/levels-sim.mjs [games]
import { build } from "esbuild";
await build({ entryPoints: { levels: "../agent/src/levels.ts", rules: "../agent/src/rules.ts" }, bundle: true, format: "esm", platform: "node", outdir: "test/.build", logLevel: "error" });
const L = await import("./.build/levels.js");
const R = await import("./.build/rules.js");
const { PIECES, Phase } = R;

export function playGame(levelA, levelB, rnd = Math.random) {
  const lay = [L.layoutFor(levelA, 0, rnd), L.layoutFor(levelB, 1, rnd)];
  const truth = [];
  const board = new Array(64).fill(0);
  for (let s = 0; s < 2; s++) for (let i = 0; i < PIECES; i++) {
    const pos = R.startSquare(s, i);
    truth.push({ pos, rank: lay[s].ranks[i], alive: true, revealed: false, moved: false });
    board[pos] = s * PIECES + i + 1;
  }
  let turn = 0;
  for (let ply = 0; ply < 400; ply++) {
    const view = { id: 1n, board, pieces: truth.map((p) => ({ ...p, rank: p.revealed ? p.rank : 0, commitment: "" })),
      match: { phase: Phase.Playing, turn, deadline: 10n ** 12n, committed: [true, true], verified: [false, false], players: ["a", "b"], ply } };
    const act = L.decideLevel(view, turn, lay[turn], 0n, [levelA, levelB][turn], rnd);
    if (act.kind !== "move") return { winner: 1 - turn, ply, why: "stuck" };
    const m = act.move, aid = board[m.from] - 1, a = truth[aid];
    if (m.attack || m.dist > 1) a.revealed = true;
    a.moved = true;
    if (!m.attack) { board[m.from] = 0; board[m.to] = aid + 1; a.pos = m.to; }
    else {
      const did = board[m.to] - 1, d = truth[did]; d.revealed = true;
      const o = R.combatOutcome(a.rank, d.rank);
      if (o === 0) { d.alive = false; board[m.to] = aid + 1; board[m.from] = 0; a.pos = m.to; if (d.rank === 0) return { winner: turn, ply }; }
      else if (o === 1) { a.alive = false; board[m.from] = 0; }
      else { a.alive = false; d.alive = false; board[m.from] = 0; board[m.to] = 0; }
    }
    turn = 1 - turn;
  }
  return { winner: 2, ply: 400 };
}

const N = Number(process.argv[2] ?? 200);
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [x, y] of [["hard", "normal"], ["hard", "easy"], ["normal", "easy"]]) {
    const t = [0, 0, 0];
    for (let g = 0; g < N; g++) { const swap = g % 2; const r = playGame(swap ? y : x, swap ? x : y); const w = r.winner === 2 ? 2 : (r.winner === 0) !== !!swap ? 0 : 1; t[w]++; }
    console.log(`${x} vs ${y}: ${x} ${t[0]} - ${y} ${t[1]} - draws ${t[2]}  (${(100 * (t[0] + t[2] / 2) / N).toFixed(0)}% score)`);
  }
}
