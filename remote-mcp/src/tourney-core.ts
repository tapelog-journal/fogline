// Pure bracket logic for Fogline tournaments (no I/O; unit-tested in test/tourney.test.mjs).
// Single elimination. Prizes are valueless test fUSD and decorative cosmetics only: never real money.
// Game for entertainment. Testnet only.

export type BotLevel = "easy" | "normal" | "hard";
export interface Entrant { address: string; objectId?: string; name?: string; client: string; rating: number; bot?: BotLevel; persona?: string; joinedAt: number }
export interface Pairing { a: number | null; b: number | null; matchId?: string; winner?: number; status: "waiting" | "playing" | "done"; note?: string; startedAt?: number; error?: string }
export interface Prize { place: 1 | 2; item: number; itemName: string; fusd: number }
export interface Tourney {
  id: string; name: string; kind: "weekly" | "practice" | "cup" | "major";
  /** sign-ups close this long before the start (ms) */ signupCloseMs?: number;
  /** exhibition: nobody signed up, so TapeLog bot personas play it out onchain (not rated, no prizes) */ exhibition?: boolean;
  /** exhibition games stop at this many plies; the side with fewer pieces resigns */ maxPlies?: number;
  signupOpens: number; startsAt: number; turnTimeout: number; roundCapMs: number; maxHumans: number; fillBots: boolean;
  status: "signup" | "running" | "done" | "cancelled" | "skipped";
  finalMatchId?: string;
  entrants: Entrant[]; rounds: Pairing[][]; prizes: Prize[];
  champion?: number; runnerUp?: number; prizeTxs?: { place: number; to: string; txs: string[]; error?: string }[];
  createdAt: number; endedAt?: number; note?: string;
}

export const PRIZES: Prize[] = [
  { place: 1, item: 21, itemName: "Gilded Victory Banner", fusd: 250 },
  { place: 2, item: 22, itemName: "Tape Victory Banner", fusd: 100 },
];
export const CUP_PRIZES: Prize[] = [
  { place: 1, item: 22, itemName: "Tape Victory Banner", fusd: 100 },
  { place: 2, item: 0, itemName: "", fusd: 50 },
];
// ---- frequent cups: every 4 hours, UTC-aligned (00, 04, 08, 12, 16, 20 UTC)
export const CUP_EVERY_H = 4;
export const CUP_SIZE = 8;
export const CUP_SIGNUP_CLOSE_MS = 5 * 60_000;
export const CUP_TURN_S = 60; // contract minimum
export const CUP_ROUND_CAP_MS = 15 * 60_000; // 3 rounds -> about 50 minutes at most
export const MAJOR_TURN_S = 120;
export const MAJOR_ROUND_CAP_MS = 25 * 60_000;
/** Bot-only exhibitions run in these UTC hours (every cup slot); they still pause when the funder is below the exhibition floor. */
export const EXHIBITION_HOURS = [0, 4, 8, 12, 16, 20];
export const EXHIBITION_MAX_PLIES = 100;

/** Next cup start: the next 4-hour UTC boundary whose sign-up is still open (closes 5 minutes before). */
export function cupStart(now: number): number {
  const step = CUP_EVERY_H * 3600_000;
  let t = Math.ceil(now / step) * step;
  if (t - CUP_SIGNUP_CLOSE_MS <= now) t += step;
  return t;
}
export const isExhibitionSlot = (startsAt: number) => EXHIBITION_HOURS.includes(new Date(startsAt).getUTCHours());
const hhmm = (ts: number) => { const d = new Date(ts); return `${d.toISOString().slice(5, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`; };
export function newCup(now: number, number: number, startsAt = cupStart(now)): Tourney {
  return {
    id: `cup-${new Date(startsAt).toISOString().slice(0, 13)}`, name: `Fogline Cup #${number}`, kind: "cup",
    signupOpens: now, startsAt, signupCloseMs: CUP_SIGNUP_CLOSE_MS, turnTimeout: CUP_TURN_S, roundCapMs: CUP_ROUND_CAP_MS, maxHumans: CUP_SIZE, fillBots: true,
    status: "signup", entrants: [], rounds: [], prizes: CUP_PRIZES, createdAt: now, note: `starts ${hhmm(startsAt)}`,
  };
}
/** The Sunday Major: the weekly 16-player bracket (Sunday 18:00 UTC). */
export function newMajor(now: number, number: number): Tourney {
  return { ...newWeekly(now, number), name: `Fogline Sunday Major #${number}`, kind: "major", signupCloseMs: CUP_SIGNUP_CLOSE_MS, turnTimeout: MAJOR_TURN_S, roundCapMs: MAJOR_ROUND_CAP_MS };
}
/** Turn an existing weekly (still in sign-up) into a Sunday Major. */
export function asMajor(t: Tourney): Tourney {
  if (t.kind !== "weekly" || t.status !== "signup") return t;
  return { ...t, kind: "major", name: t.name.replace("Fogline Weekly", "Fogline Sunday Major (Weekly") + (t.name.startsWith("Fogline Weekly") ? ")" : ""), maxHumans: MAX_BRACKET, signupCloseMs: CUP_SIGNUP_CLOSE_MS, turnTimeout: MAJOR_TURN_S, roundCapMs: MAJOR_ROUND_CAP_MS };
}
export const signupClosesAt = (t: Tourney) => t.startsAt - (t.signupCloseMs ?? 0);

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
export function startBracket(t: Tourney, now: number, opts: { personas?: Entrant[]; skipNote?: string } = {}): Tourney {
  const humans = t.entrants.filter((e) => !e.bot).sort((x, y) => y.rating - x.rating || x.joinedAt - y.joinedAt).slice(0, t.maxHumans);
  if (humans.length === 0 && opts.personas?.length) return exhibitionBracket(t, now, opts.personas);
  if (humans.length === 0) return t.kind === "practice" || t.kind === "weekly" ? { ...t, status: "cancelled", note: "no sign-ups", endedAt: now } : { ...t, status: "skipped", note: opts.skipNote ?? "no sign-ups", endedAt: now };
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

/** Nobody signed up: TapeLog bot personas play an 8-seat exhibition onchain (hard bots seeded first). */
export function exhibitionBracket(t: Tourney, now: number, personas: Entrant[]): Tourney {
  const size = Math.min(CUP_SIZE, 1 << Math.floor(Math.log2(Math.max(2, personas.length))));
  const lv: Record<string, number> = { hard: 0, normal: 1, easy: 2 };
  const seeded = personas.slice().sort((a, b) => lv[a.bot!] - lv[b.bot!] || a.joinedAt - b.joinedAt).slice(0, size).map((e) => ({ ...e, joinedAt: now }));
  const order = seedOrder(size), round: Pairing[] = [];
  for (let i = 0; i < size; i += 2) round.push({ a: order[i] - 1, b: order[i + 1] - 1, status: "waiting" });
  return { ...t, name: `${t.name} · Exhibition`, exhibition: true, maxPlies: EXHIBITION_MAX_PLIES, prizes: [], entrants: seeded, rounds: [round], status: "running", startsAt: Math.min(t.startsAt, now), note: "Exhibition: nobody signed up, so TapeLog bots played it out. Not rated, no prizes." };
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
    if (A.bot && B.bot && !(A.persona && B.persona)) {
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
