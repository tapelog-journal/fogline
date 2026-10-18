// Pure bracket logic for Fogline tournaments (no I/O; unit-tested in test/tourney.test.mjs).
// Single elimination. Prizes are valueless test fUSD and decorative cosmetics only: never real money.
// Game for entertainment. Testnet only.

export type BotLevel = "easy" | "normal" | "hard";
export interface Entrant { address: string; objectId?: string; name?: string; client: string; rating: number; bot?: BotLevel; joinedAt: number }
export interface Pairing { a: number | null; b: number | null; matchId?: string; winner?: number; status: "waiting" | "playing" | "done"; note?: string; startedAt?: number; error?: string }
export interface Prize { place: 1 | 2; item: number; itemName: string; fusd: number }
export interface Tourney {
  id: string; name: string; kind: "weekly" | "practice";
  signupOpens: number; startsAt: number; turnTimeout: number; roundCapMs: number; maxHumans: number; fillBots: boolean;
  status: "signup" | "running" | "done" | "cancelled";
  entrants: Entrant[]; rounds: Pairing[][]; prizes: Prize[];
  champion?: number; runnerUp?: number; prizeTxs?: { place: number; to: string; txs: string[]; error?: string }[];
  createdAt: number; endedAt?: number; note?: string;
}

export const PRIZES: Prize[] = [
  { place: 1, item: 21, itemName: "Gilded Victory Banner", fusd: 250 },
  { place: 2, item: 22, itemName: "Tape Victory Banner", fusd: 100 },
];
export const BOT_LEVELS: BotLevel[] = ["hard", "normal", "easy"];
const LEVEL_RANK: Record<BotLevel, number> = { hard: 3, normal: 2, easy: 1 };
export const MAX_BRACKET = 16;

/** Weekly schedule: every Sunday 18:00 UTC (2pm US Eastern in summer time). Signup opens a week before. */
export function weeklyStart(now: number): number {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0 = Sunday
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((7 - day) % 7), 18, 0, 0);
  return t > now ? t : t + 7 * 86_400_000;
}
/** ISO-8601 week label (e.g. 2026-W42) for a timestamp. */
export function isoWeek(ts: number): string {
  const d = new Date(ts);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear(), w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export function newWeekly(now: number, number: number): Tourney {
  const startsAt = weeklyStart(now);
  return {
    id: isoWeek(startsAt), name: `Fogline Weekly #${number}`, kind: "weekly",
    signupOpens: now, startsAt, turnTimeout: 300, roundCapMs: 3 * 3600_000, maxHumans: MAX_BRACKET, fillBots: true,
    status: "signup", entrants: [], rounds: [], prizes: PRIZES, createdAt: now,
  };
}

const nextPow2 = (n: number) => { let s = 2; while (s < n) s *= 2; return s; };
/** Standard seed order for a bracket of `size` (1 v size, 2 v size-1, ... arranged so top seeds meet last). */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) { const n = order.length * 2; order = order.flatMap((s) => [s, n + 1 - s]); }
  return order;
}

/** Close signup: seed humans by rating (earlier signup breaks ties), add TapeLog bots to fill the bracket, pair round 1. */
export function startBracket(t: Tourney, now: number): Tourney {
  const humans = t.entrants.filter((e) => !e.bot).sort((x, y) => y.rating - x.rating || x.joinedAt - y.joinedAt).slice(0, t.maxHumans);
  if (humans.length === 0) return { ...t, status: "cancelled", note: "no sign-ups", endedAt: now };
  const size = Math.min(MAX_BRACKET, nextPow2(Math.max(2, humans.length + (t.fillBots ? 1 : 0))));
  const bots: Entrant[] = [];
  if (t.fillBots) for (let i = 0; humans.length + bots.length < size; i++) {
    const lv = BOT_LEVELS[i % 3];
    bots.push({ address: `house:${lv}`, name: `TapeLog bot (${lv[0].toUpperCase() + lv.slice(1)})`, client: "house", rating: 0, bot: lv, joinedAt: now });
  }
  const seeded = [...humans, ...bots]; // seed 1 = best-rated human; bots are the lowest seeds, so top humans meet bots first
  const order = seedOrder(size);
  const slot = (seed: number) => (seed <= seeded.length ? seed - 1 : null);
  const round: Pairing[] = [];
  for (let i = 0; i < size; i += 2) round.push({ a: slot(order[i]), b: slot(order[i + 1]), status: "waiting" });
  return settleAuto({ ...t, entrants: seeded, rounds: [round], status: "running", startsAt: Math.min(t.startsAt, now) }, now);
}

/** Seed number of an entrant (index + 1 after startBracket). */
const seedOf = (i: number) => i + 1;
/** Decide pairings that need no game: byes, and TapeLog bot vs TapeLog bot (the bots never play themselves: higher level advances). */
export function settleAuto(t: Tourney, now: number): Tourney {
  const r = t.rounds[t.rounds.length - 1];
  for (const p of r) {
    if (p.status === "done") continue;
    if (p.a === null || p.b === null) { const w = p.a ?? p.b; p.winner = w ?? undefined; p.status = "done"; p.note = w === null || w === undefined ? "empty" : "bye"; continue; }
    const A = t.entrants[p.a], B = t.entrants[p.b];
    if (A.bot && B.bot) {
      const w = LEVEL_RANK[A.bot] > LEVEL_RANK[B.bot] || (LEVEL_RANK[A.bot] === LEVEL_RANK[B.bot] && p.a < p.b) ? p.a : p.b;
      p.winner = w; p.status = "done"; p.note = "TapeLog bots don't play each other: the higher level advances";
    }
  }
  return advance(t, now);
}

/** When every pairing in the current round is done, build the next round (or finish). */
export function advance(t: Tourney, now: number): Tourney {
  const r = t.rounds[t.rounds.length - 1];
  if (!r.every((p) => p.status === "done")) return t;
  const winners = r.map((p) => p.winner ?? null);
  if (r.length === 1) {
    const p = r[0];
    const champ = p.winner, ru = p.winner === p.a ? p.b : p.a;
    return { ...t, status: "done", champion: champ ?? undefined, runnerUp: ru ?? undefined, endedAt: now };
  }
  const next: Pairing[] = [];
  for (let i = 0; i < winners.length; i += 2) next.push({ a: winners[i], b: winners[i + 1], status: "waiting" });
  return settleAuto({ ...t, rounds: [...t.rounds, next] }, now);
}

/**
 * Record a finished onchain match. `winnerSide` 0/1 from the chain, 2 = draw or nobody played.
 * A draw advances the better seed (it is noted on the bracket).
 */
export function recordResult(t: Tourney, round: number, idx: number, winnerSide: number, now: number, note?: string): Tourney {
  const p = t.rounds[round][idx];
  if (p.status === "done" || p.a === null || p.b === null) return t;
  if (winnerSide === 0) p.winner = p.a; else if (winnerSide === 1) p.winner = p.b;
  else { p.winner = seedOf(p.a) < seedOf(p.b) ? p.a : p.b; p.note = note ?? "draw: the better seed advances"; }
  if (note && winnerSide < 2) p.note = note;
  p.status = "done";
  return advance(t, now);
}

/** Round-cap adjudication from public info only: more pieces left on the board wins; a tie goes to the better seed. */
export function adjudicate(alive: [number, number]): number { return alive[0] > alive[1] ? 0 : alive[1] > alive[0] ? 1 : 2; }

export function displayName(e: Entrant | undefined) { return !e ? "—" : e.name ?? `${e.address.slice(0, 6)}…${e.address.slice(-4)}`; }
