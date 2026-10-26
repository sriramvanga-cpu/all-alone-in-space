// Pure rules. rng() is uniform on [0, 1), same contract as Math.random.

export const START_FUEL = 10;
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

// Narrow band so a right answer is usually enough and a wrong one usually is not.
// Outer stays easier than inner. The old 0–100 draw made the shell a coin flip.
const PERCENT_LO = 30;
const PERCENT_HI = 75;
const ANSWER_SHIFT = 25;

/** Two ints in the band. Inner keeps max, outer keeps min, middle keeps half-up average. */
export function drawPercent(shell, rng = Math.random) {
  const a = rollInt(rng, PERCENT_LO, PERCENT_HI);
  const b = rollInt(rng, PERCENT_LO, PERCENT_HI);
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

/** Settled first. Then more worlds, then more fuel left. Wins break remaining ties on time left; losses on who lasted longer. */
export function compareRuns(a, b) {
  const as = a.settled ? 1 : 0;
  const bs = b.settled ? 1 : 0;
  if (as !== bs) return bs - as;
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

function shuffleWith(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh sum, difference, or product. Not drawn from a fixed card list. */
export function makeFuelCard(rng = Math.random) {
  const kind = rollInt(rng, 0, 2);
  let a;
  let b;
  let answer;
  let op;
  if (kind === 0) {
    a = rollInt(rng, 12, 89);
    b = rollInt(rng, 12, 89);
    answer = a + b;
    op = "+";
  } else if (kind === 1) {
    a = rollInt(rng, 24, 99);
    b = rollInt(rng, 3, Math.min(40, a - 3));
    answer = a - b;
    op = "−";
  } else {
    a = rollInt(rng, 3, 12);
    b = rollInt(rng, 3, 12);
    answer = a * b;
    op = "×";
  }
  const choices = new Set([String(answer)]);
  let guard = 0;
  while (choices.size < 4 && guard < 40) {
    guard += 1;
    const n = answer + rollInt(rng, 1, 9) * (rng() < 0.5 ? -1 : 1);
    if (n >= 0 && n !== answer) choices.add(String(n));
  }
  return { prompt: `${a} ${op} ${b}`, choices: shuffleWith([...choices], rng), answer: String(answer) };
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
