// Pure Elo math for the Fogline ladder (unit-tested).
export const START_RATING = 1200;
/** Expected-score Elo with K = 40 for the first 10 games, then 24. */
export function elo(ra: number, rb: number, scoreA: number, gamesA: number, gamesB: number): [number, number] {
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  const ka = gamesA < 10 ? 40 : 24, kb = gamesB < 10 ? 40 : 24;
  return [Math.round(ra + ka * (scoreA - ea)), Math.round(rb + kb * ((1 - scoreA) - (1 - ea)))];
}

