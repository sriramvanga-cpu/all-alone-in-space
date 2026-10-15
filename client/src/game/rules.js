// Pure rules. rng() is uniform on [0, 1), same contract as Math.random.

export const START_FUEL = 30;
export const START_CREDITS = 0;
export const START_VARIABLE = 1;

export const SHOP_PACKS = Object.freeze([
  Object.freeze({ credits: 10, fuel: 5 }),
  Object.freeze({ credits: 18, fuel: 10 }),
  Object.freeze({ credits: 25, fuel: 15 }),
]);

function rollInt(rng, lo, hi) {
  const span = hi - lo + 1;
  const pick = Math.floor(rng() * span);
  return lo + Math.min(span - 1, Math.max(0, pick));
}

/** Two ints 0–100. Inner keeps max, outer keeps min, middle keeps half-up average. */
export function drawPercent(shell, rng = Math.random) {
  const a = rollInt(rng, 0, 100);
  const b = rollInt(rng, 0, 100);
  if (shell === "inner") return Math.max(a, b);
  if (shell === "outer") return Math.min(a, b);
  if (shell === "middle") return Math.round((a + b) / 2);
  throw new Error(`unknown shell: ${shell}`);
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
  return Math.max(0.1, variable * multiplier);
}

/**
 * After a habitability answer. Right: percent −10, +15 credits, variable
 * unchanged. Wrong: percent +10, no credits, one multiplier. Then a secret
 * int 0–100. Win only when roll > percent (equal loses and closes the planet).
 * Percent is not capped.
 * Wrong consumes two rng() samples for the multiplier, then one for the roll.
 * Right consumes only the roll sample.
 */
export function habitability(state, correct, rng = Math.random) {
  let { percent, credits, variable } = state;
  let multiplier = null;
  if (correct) {
    percent -= 10;
    credits += 15;
  } else {
    percent += 10;
    multiplier = drawMultiplier(rng);
    variable = applyMultiplier(variable, multiplier);
  }
  const roll = rollInt(rng, 0, 100);
  const won = roll > percent;
  return { percent, credits, variable, roll, multiplier, won, closed: !won };
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

/**
 * Buy a multiset of shop packs. `counts[i]` is how many of SHOP_PACKS[i].
 * Any multiset whose credit cost is within budget is allowed.
 * On success, `credits` is the new balance and `fuel` is the new tank.
 */
export function buyPacks(state, counts) {
  const { credits, fuel } = state;
  const refuse = (cost = 0) => ({ ok: false, credits, fuel, cost });
  if (!Array.isArray(counts) || counts.length > SHOP_PACKS.length) return refuse();
  let cost = 0;
  let gained = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (!Number.isInteger(n) || n < 0) return refuse();
    cost += SHOP_PACKS[i].credits * n;
    gained += SHOP_PACKS[i].fuel * n;
  }
  if (cost > credits) return refuse(cost);
  return { ok: true, credits: credits - cost, fuel: fuel + gained, cost };
}
