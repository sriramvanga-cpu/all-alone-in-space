import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  fuelCost,
  idealCost,
  score,
  compareRuns,
  runPoints,
  affordableVariable,
  drawMultiplier,
  applyMultiplier,
  landingChance,
  timeChance,
  siteSettles,
  answerPlanet,
  fuelMinute,
  buyPacks,
  scanReadings,
  TOXIC_LIMIT,
  STREAK,
  fuelStreak,
  START_POWER,
  hopPower,
} from "./rules.js";
import {
  STATION,
  SYSTEMS,
  PLANETS,
  LANES,
  TILT,
  system,
  planet,
  planetsOf,
  lanesFrom,
  orbitAt,
  hopDistance,
  ringLabelAngle,
} from "./map.js";

function scripted(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("rng exhausted");
    return values[i++];
  };
}

/** Unit sample that rollInt maps to the inclusive integer k. */
function unit(k, span) {
  return k / span;
}

test("fuel cost, ideal cost, and the worked score", () => {
  assert.equal(fuelCost(1, 10), 5);
  assert.equal(fuelCost(1.5, 8), 6);
  assert.equal(fuelCost(1.2, 8), 4.8);
  assert.equal(idealCost(10), 5);
  assert.equal(idealCost(8), 4);
  assert.equal(idealCost(12), 6);

  const path = [
    { actual: fuelCost(1, 10), ideal: idealCost(10) },
    { actual: fuelCost(1.5, 8), ideal: idealCost(8) },
    { actual: fuelCost(1.2, 8), ideal: idealCost(8) },
  ];
  assert.deepEqual(
    path.map((hop) => hop.actual),
    [5, 6, 4.8],
  );
  assert.deepEqual(
    path.map((hop) => hop.ideal),
    [5, 4, 4],
  );
  assert.equal(score(path), -2.8);
  assert.equal(score([{ actual: fuelCost(1, 12), ideal: idealCost(12) }]), 0);
});

test("settled runs rank above losses; wins rank by points, losses by worlds, fuel left, and time", () => {
  const win = { settled: true, timeLeft: 100, fuel: 0, worlds: 1, id: 1 };
  const luckyLoss = { settled: false, timeLeft: 0, fuel: 40, worlds: 8, id: 2 };
  assert.ok(compareRuns(win, luckyLoss) < 0);
  assert.equal(runPoints(luckyLoss), 0);

  // 1 per 2 fuel, 1 per 6 s left, nothing per world: a fast win beats a slow tour.
  const explorer = { settled: true, timeLeft: 100, fuel: 1, worlds: 12, id: 3 };
  const sprinter = { settled: true, timeLeft: 800, fuel: 5, worlds: 1, id: 4 };
  assert.equal(runPoints(explorer), 17.17);
  assert.equal(runPoints(sprinter), 135.83);
  assert.ok(compareRuns(sprinter, explorer) < 0);

  const rich = { settled: true, timeLeft: 100, fuel: 13.4, worlds: 2, id: 5 };
  assert.equal(runPoints(rich), 23.37);

  const wide = { settled: true, timeLeft: 120, fuel: 10, worlds: 2, id: 5 };
  const deep = { settled: true, timeLeft: 60, fuel: 30, worlds: 1, id: 6 };
  assert.equal(runPoints(wide), runPoints(deep));
  assert.ok(compareRuns(wide, deep) < 0);

  const sooner = { settled: true, timeLeft: 200, fuel: 5, worlds: 2, id: 7 };
  const later = { settled: true, timeLeft: 100, fuel: 5, worlds: 2, id: 8 };
  assert.ok(compareRuns(sooner, later) < 0);

  const far = { settled: false, timeLeft: 400, fuel: 1, worlds: 3, id: 9 };
  const near = { settled: false, timeLeft: 10, fuel: 20, worlds: 1, id: 10 };
  assert.ok(compareRuns(far, near) < 0);

  const lasted = { settled: false, timeLeft: 30, fuel: 5, worlds: 2, id: 11 };
  const quit = { settled: false, timeLeft: 800, fuel: 5, worlds: 2, id: 12 };
  assert.ok(compareRuns(lasted, quit) < 0);
});

test("a price rise is held to the cheapest exit the tank could pay for, and stands when it couldn't", () => {
  // 5 fuel covers a lane of 8 up to x1.25.
  assert.equal(affordableVariable(1, 2, 5, [8, 16]), 1.25);
  assert.equal(affordableVariable(1.2, 2, 5, [8]), 1.25);
  assert.equal(affordableVariable(1, 1.1, 5, [8]), 1.1);
  // At x1.5 the tank already couldn't pay for the lane, so the rise stands.
  assert.equal(affordableVariable(1.5, 2, 5, [8]), 2);
  // A low tank (2 fuel, lanes of 16) or an empty one can't wipe out the rise.
  assert.equal(affordableVariable(1, 1.8, 2, [16]), 1.8);
  assert.equal(affordableVariable(1, 2, 0, [8]), 2);
  // A price that didn't rise, or no lanes, is left alone.
  assert.equal(affordableVariable(2, 1.5, 5, [8]), 1.5);
  assert.equal(affordableVariable(3, 3, 1, [16]), 3);
  assert.equal(affordableVariable(1, 2, 5, []), 2);
});

test("the landing chance climbs from 0% to 60% over 15 minutes, slowly at first; right adds a tenth of it (up to 65), wrong halves it", () => {
  const min = 60_000;
  assert.equal(timeChance(0), 0);
  assert.equal(timeChance(-1000), 0);
  assert.equal(timeChance(5 * min), 7);
  assert.equal(timeChance(7.5 * min), 15);
  assert.equal(timeChance(10 * min), 27);
  assert.equal(timeChance(15 * min), 60);
  assert.equal(timeChance(20 * min), 60);
  assert.equal(landingChance(0, true), 0);
  assert.equal(landingChance(0, false), 0);
  assert.equal(landingChance(7.5 * min, true), 17);
  assert.equal(landingChance(10 * min, true), 30);
  assert.equal(landingChance(10 * min, false), 14);
  assert.equal(landingChance(15 * min, true), 65);
  assert.equal(landingChance(15 * min, false), 30);
});

test("a landing site settles when its roll of 0–99 comes in under the chance", () => {
  const roll = (k) => () => (k + 0.5) / 100;
  assert.equal(siteSettles(30, roll(29)), true);
  assert.equal(siteSettles(30, roll(30)), false);
  assert.equal(siteSettles(5, roll(0)), true);
  assert.equal(siteSettles(65, roll(99)), false);
});

test("multiplier band is 0–1 only on roll 1", () => {
  for (let roll = 1; roll <= 10; roll++) {
    const multiplier = drawMultiplier(scripted([unit(roll - 1, 10), 0.25]));
    if (roll === 1) {
      assert.equal(multiplier, 0.25);
      assert.ok(multiplier >= 0 && multiplier <= 1);
      assert.ok(multiplier < 1);
    } else {
      assert.equal(multiplier, 1.25);
      assert.ok(multiplier >= 1 && multiplier <= 2);
      assert.ok(multiplier > 1);
    }
  }
  assert.equal(drawMultiplier(scripted([unit(0, 10), 0])), 0);
  assert.equal(drawMultiplier(scripted([unit(0, 10), 1])), 1);
  assert.equal(drawMultiplier(scripted([unit(1, 10), 0])), 1);
  assert.equal(drawMultiplier(scripted([unit(9, 10), 1])), 2);
});

test("applyMultiplier floors at 1", () => {
  assert.equal(applyMultiplier(2, 1.5), 3);
  assert.equal(applyMultiplier(0.4, 0.2), 1);
});

test("a wrong answer applies one multiplier and pays nothing; a right one pays 15", () => {
  const wrong = answerPlanet({ credits: 20, variable: 1 }, false, scripted([unit(1, 10), 0.5]));
  assert.deepEqual(wrong, { credits: 20, variable: 1.5, multiplier: 1.5 });
  const right = answerPlanet({ credits: 3, variable: 2 }, true, scripted([]));
  assert.deepEqual(right, { credits: 18, variable: 2, multiplier: null });
});

test("toxic reading is over the limit exactly when the world is not habitable", () => {
  for (const sample of [0, 0.5, 0.999999]) {
    const toxic = (habitable) => scanReadings(habitable, () => sample).find((r) => r.toxic).value;
    assert.ok(toxic(true) < TOXIC_LIMIT, `habitable at ${sample}`);
    assert.ok(toxic(false) > TOXIC_LIMIT, `not habitable at ${sample}`);
  }
});

test("fuel minute: 1 of 8 updates, exactly 10% does not", () => {
  const eight = fuelMinute(
    1,
    ["wrong", ...Array(7).fill("right")],
    scripted([unit(5, 10), 0.5]),
  );
  assert.equal(eight.applied, true);
  assert.equal(eight.multiplier, 1.5);
  assert.equal(eight.variable, 1.5);
  assert.equal(eight.credits, 7);

  const ten = fuelMinute(1, ["wrong", ...Array(9).fill("right")], () => {
    throw new Error("rng should not be called at exactly 10%");
  });
  assert.equal(ten.applied, false);
  assert.equal(ten.variable, 1);
  assert.equal(ten.multiplier, null);
  assert.equal(ten.credits, 9);

  const none = fuelMinute(1.4, ["skip", "skip"], () => {
    throw new Error("rng should not be called with no completed answers");
  });
  assert.equal(none.variable, 1.4);
  assert.equal(none.applied, false);
  assert.equal(none.credits, 0);

  const skipsIgnored = fuelMinute(
    1,
    ["wrong", "skip", "skip"],
    scripted([unit(5, 10), 0.5]),
  );
  assert.equal(skipsIgnored.applied, true);
  assert.equal(skipsIgnored.variable, 1.5);
  assert.equal(skipsIgnored.credits, 0);
});

test("shop packs are any affordable multiset", () => {
  assert.deepEqual(SHOP_PACKS, [
    { credits: 10, fuel: 5 },
    { credits: 18, fuel: 10 },
    { credits: 25, fuel: 15 },
    { credits: 6, power: 5 },
  ]);
  assert.equal(START_FUEL, 10);
  assert.equal(START_POWER, 10);
  assert.equal(START_CREDITS, 0);
  assert.equal(START_VARIABLE, 1);

  const oneOfEach = buyPacks({ credits: 53, fuel: 1 }, [1, 1, 1]);
  assert.deepEqual(oneOfEach, { ok: true, credits: 0, fuel: 31, power: 0, cost: 53 });

  const twoSmall = buyPacks({ credits: 20, fuel: 0 }, [2, 0, 0]);
  assert.equal(twoSmall.ok, true);
  assert.equal(twoSmall.credits, 0);
  assert.equal(twoSmall.fuel, 10);

  const keep = buyPacks({ credits: 7, fuel: 4 }, [0, 0, 0]);
  assert.deepEqual(keep, { ok: true, credits: 7, fuel: 4, power: 0, cost: 0 });

  const poor = buyPacks({ credits: 24, fuel: 3 }, [0, 0, 1]);
  assert.deepEqual(poor, { ok: false, credits: 24, fuel: 3, power: 0, cost: 25 });

  const mixed = buyPacks({ credits: 16, fuel: 2, power: 1 }, [1, 0, 0, 1]);
  assert.deepEqual(mixed, { ok: true, credits: 0, fuel: 7, power: 6, cost: 16 });

  const negative = buyPacks({ credits: 100, fuel: 0 }, [-1, 0, 0]);
  assert.equal(negative.ok, false);
  assert.equal(negative.credits, 100);
  assert.equal(negative.fuel, 0);
});

test("the star map has 20+ systems in three rings, each with 1–3 fuel and 0–2 test planets", () => {
  assert.ok(SYSTEMS.length >= 20, `${SYSTEMS.length} systems`);
  const meanR = (ring) => {
    const rs = SYSTEMS.filter((s) => s.ring === ring);
    assert.ok(rs.length > 0, ring);
    return rs.reduce((sum, s) => sum + s.r, 0) / rs.length;
  };
  assert.ok(meanR("inner") < meanR("middle") && meanR("middle") < meanR("outer"));
  for (const s of SYSTEMS) {
    const planets = planetsOf(s.id);
    const fuel = planets.filter((p) => p.shell === "fuel").length;
    assert.ok(fuel >= 1 && fuel <= 3, `${s.id} has ${fuel} fuel planets`);
    assert.ok(planets.length - fuel <= 2, `${s.id} has ${planets.length - fuel} test planets`);
    for (const p of planets) if (p.shell !== "fuel") assert.equal(p.shell, s.ring, p.id);
  }
  const names = [STATION, ...SYSTEMS.map((s) => s.id), ...PLANETS.map((p) => p.id)];
  assert.equal(new Set(names).size, names.length);
  for (const s of SYSTEMS) assert.ok(s.star, `${s.id} has no star`);
  assert.ok(SYSTEMS.some((s) => s.star === "hole") && SYSTEMS.some((s) => s.star === "neutron"));
  assert.equal(system(STATION), null);
  assert.equal(planet(SYSTEMS[0].id), null);
});

test("lanes join every system without crossing, and cost fuel by the farther ring", () => {
  const xy = (id) => {
    const s = system(id);
    return s ? { x: s.r * Math.cos(s.angle), y: s.r * Math.sin(s.angle) } : { x: 0, y: 0 };
  };
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (const [i, e] of LANES.entries()) {
    for (const f of LANES.slice(i + 1)) {
      assert.ok(!(e.a === f.a && e.b === f.b) && !(e.a === f.b && e.b === f.a), `${e.a}-${e.b} twice`);
      if ([e.a, e.b].includes(f.a) || [e.a, e.b].includes(f.b)) continue;
      const [a, b, c, d] = [e.a, e.b, f.a, f.b].map(xy);
      assert.ok(!(side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0), `${e.a}-${e.b} crosses ${f.a}-${f.b}`);
    }
  }
  const band = { inner: 16, middle: 24, outer: 32 };
  for (const lane of LANES) {
    const out = lane.a === STATION || lane.b === STATION;
    const length = out ? 10 : Math.max(band[system(lane.a).ring], band[system(lane.b).ring]);
    assert.equal(lane.distance, length, `${lane.a}-${lane.b}`);
  }
  const spokes = lanesFrom(STATION);
  assert.equal(spokes.length, 3);
  for (const hop of spokes) assert.equal(system(hop.id).ring, "inner");
  for (const s of SYSTEMS) {
    const n = lanesFrom(s.id).length;
    assert.ok(n >= 2 && n <= 4, `${s.id} has ${n} lanes`);
  }
  const seen = new Set([STATION]);
  const queue = [STATION];
  while (queue.length) {
    for (const hop of lanesFrom(queue.pop())) {
      if (seen.has(hop.id)) continue;
      seen.add(hop.id);
      queue.push(hop.id);
    }
  }
  assert.equal(seen.size, SYSTEMS.length + 1);
});

test("every load is the same chart, turned and renamed", async () => {
  const real = Math.random;
  const loads = [];
  for (const [i, value] of [0.2, 0.7].entries()) {
    Math.random = () => value;
    try {
      loads.push(await import(`./map.js?load=${i}`));
    } finally {
      Math.random = real;
    }
  }
  const shape = (m) => ({
    systems: m.SYSTEMS.map((s) => [s.ring, s.r, m.planetsOf(s.id).map((p) => [p.shell, p.orbit])]),
    lanes: m.LANES.map((lane) => [m.system(lane.a)?.slot ?? -1, m.system(lane.b).slot, lane.distance]),
  });
  assert.deepEqual(shape(loads[0]), shape(loads[1]));
  assert.notEqual(loads[0].SYSTEMS[0].angle, loads[1].SYSTEMS[0].angle);
  assert.notDeepEqual(loads[0].SYSTEMS.map((s) => s.id), loads[1].SYSTEMS.map((s) => s.id));
});

test("a hop is cheapest when two planets line up across the oval and dearest on opposite ends", () => {
  const p = PLANETS.find((x) => planetsOf(x.system).length >= 2);
  const q = planetsOf(p.system).find((x) => x.id !== p.id);
  const start = orbitAt(p, 0);
  const round = orbitAt(p, p.period);
  assert.ok(Math.abs(start.x - round.x) < 1e-6 && Math.abs(start.y - round.y) < 1e-6, "an orbit repeats after one period");
  assert.ok(Math.abs((start.x / p.orbit) ** 2 + (start.y / (p.orbit * TILT)) ** 2 - 1) < 1e-9, "the planet is on its oval");
  let lo = Infinity;
  let hi = 0;
  for (let ms = 0; ms < 800_000; ms += 100) {
    const d = hopDistance(p.id, q.id, ms);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  // Closest when both sit on the short axis, farthest at opposite ends of the long one.
  const gap = Math.abs(p.orbit - q.orbit);
  assert.ok(lo >= gap * TILT - 1e-9 && lo < gap * TILT + 5, `closest ${lo}`);
  assert.ok(hi <= p.orbit + q.orbit + 1e-9 && hi > p.orbit + q.orbit - 5, `farthest ${hi}`);
  assert.equal(hopPower(240), 4);
  assert.equal(hopPower(100), 1.7);
});

test("ten different fuel rounds, and every card has one right answer among four", async () => {
  const { FUEL_ROUNDS, PLANET_ORDER } = await import("./fuelRounds.js");
  assert.equal(new Set(FUEL_ROUNDS.map((r) => r.id)).size, 10);
  const checks = {
    wire: (c) => {
      const parts = c.choices.map((x) => x.split("-").map(Number));
      const fits = parts.filter(([col, holes]) => col === c.wire.c && holes === c.wire.p);
      assert.equal(fits.length, 1);
      assert.equal(c.answer, `${c.wire.c}-${c.wire.p}`);
      // A same-colour decoy and a same-holes decoy, so neither alone gives it away.
      assert.ok(parts.some(([col, holes]) => col === c.wire.c && holes !== c.wire.p));
      assert.ok(parts.some(([col, holes]) => col !== c.wire.c && holes === c.wire.p));
      assert.ok(parts.every(([col, holes]) => col >= 0 && col <= 3 && holes >= 2 && holes <= 4));
    },
    maths: (c) => {
      const [left, op, right] = c.prompt.split(" ");
      const [a, b] = [Number(left), Number(right)];
      assert.equal(c.answer, String(op === "+" ? a + b : op === "−" ? a - b : a * b), c.prompt);
      assert.ok(c.choices.every((x) => Number.isInteger(Number(x)) && Number(x) >= 0), c.prompt);
    },
    ink: (c) => assert.notEqual(c.answer.toUpperCase(), c.prompt),
    tank: (c) => assert.equal(c.answer, String(Math.max(...c.choices.map(Number)))),
    order: (c) => {
      const [a, b] = c.prompt.split(" → ");
      const [inner, outer] = a === "?" ? [c.answer, b] : [a, c.answer];
      assert.equal(PLANET_ORDER.indexOf(outer) - PLANET_ORDER.indexOf(inner), 1, c.prompt);
      // The row the screen draws says the same as the words: the shown planet's slot, and the gap beside it.
      const { shown, at, gap } = c.row;
      assert.equal(c.worlds, true);
      assert.equal(PLANET_ORDER[at], shown, c.prompt);
      assert.equal(PLANET_ORDER[gap], c.answer, c.prompt);
      assert.equal(Math.abs(at - gap), 1, c.prompt);
      assert.equal(c.prompt, gap > at ? `${shown} → ?` : `? → ${shown}`);
    },
  };
  for (const round of FUEL_ROUNDS) {
    assert.ok(Number.isInteger(round.per) && round.per >= 1, round.id);
    if (!round.make) continue;
    for (let i = 0; i < 300; i++) {
      const card = round.make();
      assert.equal(new Set(card.choices).size, 4, round.id);
      assert.ok(card.choices.includes(card.answer), round.id);
      checks[round.id]?.(card);
    }
  }
});

test("a streak pays 1 bonus credit for every 5 right in a row; a wrong answer resets it, a skip doesn't", () => {
  const r = (n) => Array(n).fill("right");
  assert.equal(STREAK, 5);
  assert.deepEqual(fuelStreak([]), { streak: 0, bonus: 0 });
  assert.deepEqual(fuelStreak(r(4)), { streak: 4, bonus: 0 });
  assert.deepEqual(fuelStreak(r(5)), { streak: 5, bonus: 1 });
  assert.deepEqual(fuelStreak(r(11)), { streak: 11, bonus: 2 });
  assert.deepEqual(fuelStreak([...r(4), "wrong", ...r(4)]), { streak: 4, bonus: 0 });
  assert.deepEqual(fuelStreak([...r(3), "skip", ...r(2), "wrong"]), { streak: 0, bonus: 1 });
});

test("every flight event has two options, and one of them is always open", async () => {
  const { FLIGHT_EVENTS, canTake } = await import("./events.js");
  assert.equal(new Set(FLIGHT_EVENTS.map((e) => e.id)).size, FLIGHT_EVENTS.length);
  for (const event of FLIGHT_EVENTS) {
    assert.equal(event.options.length, 2, event.id);
    assert.ok(event.options.some((o) => canTake(o, { fuel: 0, credits: 0 })), event.id);
  }
  assert.equal(canTake({ fuel: -1 }, { fuel: 0.9, credits: 0 }), false);
  assert.equal(canTake({ fuel: -1 }, { fuel: 1, credits: 0 }), true);
  assert.equal(canTake({ credits: -5 }, { fuel: 0, credits: 4 }), false);
});

test("every habitability card has one right answer among four, and each level has plenty", () => {
  const bank = JSON.parse(readFileSync(new URL("../data/questions.json", import.meta.url), "utf8"));
  const ids = new Set();
  for (const domain of ["general", "mental", "technology"]) {
    const count = { easy: 0, medium: 0, hard: 0 };
    for (const card of bank[domain]) {
      assert.ok(!ids.has(card.id), `${card.id} twice`);
      ids.add(card.id);
      assert.ok(card.level in count, card.id);
      count[card.level] += 1;
      assert.equal(new Set(card.choices).size, 4, card.id);
      assert.ok(card.choices.includes(card.answer), card.id);
    }
    assert.ok(count.easy >= 16 && count.medium >= 12 && count.hard >= 12, `${domain} ${JSON.stringify(count)}`);
  }
});

test("each ring's label sits in a gap, clear of that ring's systems", () => {
  for (const ring of ["inner", "middle", "outer"]) {
    const at = ringLabelAngle(ring);
    const nearest = Math.min(
      ...SYSTEMS.filter((s) => s.ring === ring).map((s) => {
        const d = Math.abs(((at - s.angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return Math.min(d, 2 * Math.PI - d);
      }),
    );
    assert.ok(nearest > 0.35, `${ring} label is ${nearest.toFixed(2)} rad from a system`);
  }
});
