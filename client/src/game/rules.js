// Pure rules. rng() is uniform on [0, 1), same contract as Math.random.

export const START_FUEL = 10;
export const START_CREDITS = 0;
export const START_VARIABLE = 1;

// Power pays for scans and for hops between planets; fuel only flies the lanes between systems.
// Inside a system the sun recharges power by 1 every POWER_TICK_MS, up to POWER_CAP.
export const START_POWER = 10;
export const POWER_CAP = 10;
export const POWER_TICK_MS = 20_000;
// A star-map scan, which reveals the systems one lane away.
export const MAP_SCAN_POWER = 1;
// Power per unit of distance between two planets (orbits sit 65 units apart): a hop costs about
// 1–11, 4.8 on average. Dearer hops or slower recharge leave players waiting rather than playing.
export const HOP_K = 0.0167;

/** Power for a hop of this many system units, to one decimal so the live label stays readable. */
export function hopPower(distance) {
  return Math.round(distance * HOP_K * 10) / 10;
}

export const SHOP_PACKS = Object.freeze([
  Object.freeze({ credits: 10, fuel: 5 }),
  Object.freeze({ credits: 18, fuel: 10 }),
  Object.freeze({ credits: 25, fuel: 15 }),
  Object.freeze({ credits: 6, power: 5 }),
]);

export function rollInt(rng, lo, hi) {
  const span = hi - lo + 1;
  const pick = Math.floor(rng() * span);
  return lo + Math.min(span - 1, Math.max(0, pick));
}

// Each shell draws from its own band, so a right answer rarely settles an inner
// world and settles an outer one most often. With the 25-point answer shift and a
// 0–100 roll, landing blind after a right answer settles about: inner 5%, middle
// 25%, outer 30%; a scan's second site (it costs power) lifts those to 10%, 43% and 50%.
// Percent can exceed 100; the roll still has to beat it.
const SHELL_BANDS = Object.freeze({
  inner: [108, 125],
  middle: [85, 115],
  outer: [83, 120],
});
const ANSWER_SHIFT = 25;

/** Two ints in the shell's band. Inner keeps max, outer keeps min, middle keeps half-up average. */
export function drawPercent(shell, rng = Math.random) {
  const band = SHELL_BANDS[shell];
  if (!band) throw new Error(`unknown shell: ${shell}`);
  const a = rollInt(rng, band[0], band[1]);
  const b = rollInt(rng, band[0], band[1]);
  if (shell === "inner") return Math.max(a, b);
  if (shell === "outer") return Math.min(a, b);
  return Math.round((a + b) / 2);
}

export function fuelCost(variable, distance) {
  return variable * distance * 0.5;
}

export function idealCost(distance) {
  return distance / 2;
}

/** Sum of ideal costs minus fuel actually paid. Credits are not points. */
export function score(path) {
  const raw = path.reduce((sum, hop) => sum + hop.ideal - hop.actual, 0);
  // ponytail: snap 1e-10 so 13-15.8 === -2.8; drop if scores move to integers
  return Math.round(raw * 1e10) / 1e10;
}

/** A win's points: 1 per fuel left, 1 per 10 seconds left. A loss scores 0. No per-world points: they made a slow tour outrank a fast win. */
export function runPoints(run) {
  if (!run.settled) return 0;
  const fuel = Number.isFinite(run.fuel) ? run.fuel : Number(run.score) || 0;
  const time = Number.isFinite(run.timeLeft) ? run.timeLeft : 0;
  return Math.round((fuel + time / 10) * 100) / 100;
}

/** Settled first. Wins then rank by points. Ties, and all losses: more worlds, then more fuel left, then time left for wins or time lasted for losses. */
export function compareRuns(a, b) {
  const as = a.settled ? 1 : 0;
  const bs = b.settled ? 1 : 0;
  if (as !== bs) return bs - as;
  const ap = runPoints(a);
  const bp = runPoints(b);
  if (ap !== bp) return bp - ap;
  const aw = Number.isFinite(a.worlds) ? a.worlds : 0;
  const bw = Number.isFinite(b.worlds) ? b.worlds : 0;
  if (aw !== bw) return bw - aw;
  const af = Number.isFinite(a.fuel) ? a.fuel : Number(a.score) || 0;
  const bf = Number.isFinite(b.fuel) ? b.fuel : Number(b.score) || 0;
  if (af !== bf) return bf - af;
  const at = Number.isFinite(a.timeLeft) ? a.timeLeft : 0;
  const bt = Number.isFinite(b.timeLeft) ? b.timeLeft : 0;
  if (at !== bt) return as ? bt - at : at - bt;
  return (a.id ?? 0) - (b.id ?? 0);
}

/** Keep the cheapest exit affordable, but never discount below 1. A lower variable is left alone. */
export function affordableVariable(variable, fuel, distances) {
  if (!(fuel > 0) || !distances.length) return variable;
  const cheapest = Math.min(...distances);
  const cap = (2 * fuel) / cheapest;
  return Math.min(variable, Math.max(1, cap));
}

/**
 * Roll an int 1–10, then a continuous uniform multiplier.
 * The first rng() sample selects the roll: 1 + floor(rng() * 10).
 * The second sample is the unit interval. Continuous uniform is
 * rng() * span + lo. Roll 1 uses span 1, lo 0 (band 0–1). Rolls 2–10
 * use span 1, lo 1 (band 1–2). An endpoint is included when that
 * second sample is 0 or 1.
 */
export function drawMultiplier(rng = Math.random) {
  const roll = rollInt(rng, 1, 10);
  if (roll === 1) return rng() * 1 + 0;
  return rng() * 1 + 1;
}

export function applyMultiplier(variable, multiplier) {
  return Math.max(1, variable * multiplier);
}

export function shuffleWith(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * After a habitability answer. Right: percent −25, +15 credits, variable
 * unchanged. Wrong: percent +25, no credits, one multiplier, and the world
 * never settles. Then a secret int 0–100. A right answer settles only when
 * roll > percent (equal loses and closes the planet). Percent is not capped.
 * Wrong consumes two rng() samples for the multiplier, then one for the roll.
 * Right consumes only the roll sample.
 */
export function habitability(state, correct, rng = Math.random) {
  let { percent, credits, variable } = state;
  let multiplier = null;
  if (correct) {
    percent -= ANSWER_SHIFT;
    credits += 15;
  } else {
    percent += ANSWER_SHIFT;
    multiplier = drawMultiplier(rng);
    variable = applyMultiplier(variable, multiplier);
  }
  const roll = rollInt(rng, 0, 100);
  const won = correct && roll > percent;
  return { percent, credits, variable, roll, multiplier, won, closed: !won };
}

export const TOXIC_LIMIT = 50;

/** Scanner readings after a habitability check. Only toxic elements carry the verdict: under TOXIC_LIMIT ppm when habitable, far over it when not. */
export function scanReadings(habitable, rng = Math.random) {
  const between = (lo, hi, places = 0) => Number((lo + rng() * (hi - lo)).toFixed(places));
  return [
    { label: "Oxygen", value: between(17, 24), unit: "%" },
    { label: "Surface temp", value: between(-8, 34), unit: "°C" },
    { label: "Gravity", value: between(0.7, 1.3, 2), unit: "g" },
    { label: "Surface water", value: between(18, 82), unit: "%" },
    { label: "Toxic elements", value: habitable ? between(5, 40) : between(180, 900), unit: "ppm", toxic: true },
  ];
}

/**
 * End of a fuel minute. `answers` is "right" | "wrong" | "skip".
 * Skips are ignored. No completed answers leaves the variable unchanged.
 * One credit per right answer. If wrong/completed > 0.10, apply one
 * multiplier; at or under 0.10 the variable stays.
 */
export function fuelMinute(variable, answers, rng = Math.random) {
  let wrong = 0;
  let completed = 0;
  let credits = 0;
  for (const answer of answers) {
    if (answer === "skip") continue;
    if (answer !== "right" && answer !== "wrong") {
      throw new Error(`bad answer: ${answer}`);
    }
    completed += 1;
    if (answer === "wrong") wrong += 1;
    else credits += 1;
  }
  if (completed === 0 || wrong / completed <= 0.1) {
    return { variable, applied: false, multiplier: null, credits };
  }
  const multiplier = drawMultiplier(rng);
  return {
    variable: applyMultiplier(variable, multiplier),
    applied: true,
    multiplier,
    credits,
  };
}

export const STREAK = 5;

/** Right answers in a row at the end of a fuel minute, and 1 bonus credit for every STREAK in a row. A wrong answer resets the run; a skip doesn't. */
export function fuelStreak(answers) {
  let streak = 0;
  let bonus = 0;
  for (const answer of answers) {
    if (answer === "wrong") streak = 0;
    else if (answer === "right" && ++streak % STREAK === 0) bonus += 1;
  }
  return { streak, bonus };
}

// A scan from orbit costs this much power and checks a second landing site when the first is toxic.
export const SCAN_POWER = 1;

/** The second site of a scan: same percent, its own roll. */
export function secondSite(percent, rng = Math.random) {
  return rollInt(rng, 0, 100) > percent;
}

/**
 * Buy a multiset of shop packs. `counts[i]` is how many of SHOP_PACKS[i].
 * Any multiset whose credit cost is within budget is allowed.
 * On success, `credits` is the new balance and `fuel` and `power` are the new tanks.
 */
export function buyPacks(state, counts) {
  const { credits, fuel, power = 0 } = state;
  const refuse = (cost = 0) => ({ ok: false, credits, fuel, power, cost });
  if (!Array.isArray(counts) || counts.length > SHOP_PACKS.length) return refuse();
  let cost = 0;
  let gained = 0;
  let charged = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (!Number.isInteger(n) || n < 0) return refuse();
    cost += SHOP_PACKS[i].credits * n;
    gained += (SHOP_PACKS[i].fuel ?? 0) * n;
    charged += (SHOP_PACKS[i].power ?? 0) * n;
  }
  if (cost > credits) return refuse(cost);
  return { ok: true, credits: credits - cost, fuel: fuel + gained, power: power + charged, cost };
}
