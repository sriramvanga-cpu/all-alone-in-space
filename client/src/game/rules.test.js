import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_FUEL,
  START_CREDITS,
  START_VARIABLE,
  SHOP_PACKS,
  drawPercent,
  fuelCost,
  idealCost,
  score,
  compareRuns,
  runPoints,
  affordableVariable,
  drawMultiplier,
  applyMultiplier,
  habitability,
  fuelMinute,
  buyPacks,
  scanReadings,
  TOXIC_LIMIT,
  STREAK,
  fuelStreak,
  secondSite,
  START_POWER,
  hopPower,
} from "./rules.js";
import {
  STATION,
  SYSTEMS,
  PLANETS,
  LANES,
  JUMP_R,
  system,
  planet,
  planetsOf,
  lanesFrom,
  orbitAt,
  hopDistance,
  closestHop,
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

  // 1 per fuel, 1 per 10 s left, nothing per world: a fast win beats a slow tour.
  const explorer = { settled: true, timeLeft: 100, fuel: 1, worlds: 12, id: 3 };
  const sprinter = { settled: true, timeLeft: 800, fuel: 5, worlds: 1, id: 4 };
  assert.equal(runPoints(explorer), 11);
  assert.equal(runPoints(sprinter), 85);
  assert.ok(compareRuns(sprinter, explorer) < 0);

  const rich = { settled: true, timeLeft: 100, fuel: 13.4, worlds: 2, id: 5 };
  assert.equal(runPoints(rich), 23.4);

  const wide = { settled: true, timeLeft: 100, fuel: 10, worlds: 2, id: 5 };
  const deep = { settled: true, timeLeft: 50, fuel: 15, worlds: 1, id: 6 };
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

test("a penalty discounts to the cheapest exit but not below 1", () => {
  assert.equal(affordableVariable(2, 5, [8]), 1.25);
  assert.equal(affordableVariable(0.4, 5, [8]), 0.4);
  assert.equal(affordableVariable(2, 0, [8]), 2);
  assert.equal(affordableVariable(2, 5, []), 2);
  assert.equal(affordableVariable(2, 2, [8]), 1);
});

test("each shell draws from its own band and keeps max, min, or average", () => {
  // +0.5 keeps each value inside its slot so float error cannot floor it down.
  const rolls = (lo, hi, x, y) => scripted([unit(x - lo + 0.5, hi - lo + 1), unit(y - lo + 0.5, hi - lo + 1)]);
  assert.equal(drawPercent("inner", rolls(108, 125, 110, 120)), 120);
  assert.equal(drawPercent("inner", rolls(108, 125, 108, 125)), 125);
  assert.equal(drawPercent("middle", rolls(85, 115, 85, 96)), 91);
  assert.equal(drawPercent("middle", rolls(85, 115, 90, 110)), 100);
  assert.equal(drawPercent("outer", rolls(83, 120, 95, 85)), 85);
  assert.equal(drawPercent("outer", rolls(83, 120, 83, 120)), 83);
  assert.throws(() => drawPercent("fuel"));
});

test("a right answer settles rarely near the station and most often far out, and a scan lifts the odds", () => {
  let s = 99;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const rate = (shell, scanned) => {
    let wins = 0;
    for (let i = 0; i < 4000; i++) {
      const result = habitability({ percent: drawPercent(shell, rng), credits: 0, variable: 1 }, true, rng);
      if (result.won || (scanned && secondSite(result.percent, rng))) wins++;
    }
    return wins / 4000;
  };
  const inner = rate("inner");
  const middle = rate("middle");
  const outer = rate("outer");
  const outerScan = rate("outer", true);
  assert.ok(inner < 0.1, `inner ${inner}`);
  assert.ok(middle > inner + 0.15 && middle < outer, `middle ${middle}`);
  assert.ok(outer > 0.25 && outer < 0.35, `outer ${outer}`);
  assert.ok(outerScan > 0.45 && outerScan < 0.55, `outer with a scan ${outerScan}`);
});

test("a careful player settles more often than a guesser", () => {
  function mulberry(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function settleRate(skill, seed) {
    const rng = mulberry(seed);
    const shells = ["outer", "outer", "outer", "middle", "middle", "inner"];
    let wins = 0;
    const games = 800;
    for (let i = 0; i < games; i++) {
      let fuel = START_FUEL;
      let variable = 1;
      let settled = false;
      for (const shell of shells) {
        const cost = fuelCost(variable, 10);
        if (fuel + 1e-9 < cost) break;
        fuel -= cost;
        const correct = rng() < skill;
        const result = habitability(
          { percent: drawPercent(shell, rng), credits: 0, variable },
          correct,
          rng,
        );
        variable = result.variable;
        if (result.won) {
          settled = true;
          break;
        }
      }
      if (settled) wins++;
    }
    return wins / games;
  }
  const skilled = settleRate(0.85, 7);
  const guesser = settleRate(0.25, 7);
  assert.ok(skilled > 0.35, `skilled ${skilled}`);
  assert.ok(guesser < 0.2, `guesser ${guesser}`);
  assert.ok(skilled - guesser > 0.25, `${skilled} vs ${guesser}`);
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

test("roll equal to percent does not win", () => {
  const state = { percent: 50, credits: 0, variable: 2 };
  const lost = habitability(state, true, scripted([unit(25, 101)]));
  assert.equal(state.percent, 50);
  assert.equal(lost.percent, 25);
  assert.equal(lost.roll, 25);
  assert.equal(lost.won, false);
  assert.equal(lost.closed, true);
  assert.equal(lost.credits, 15);
  assert.equal(lost.variable, 2);
  assert.equal(lost.multiplier, null);

  const won = habitability(
    { percent: 50, credits: 3, variable: 2 },
    true,
    scripted([unit(26, 101)]),
  );
  assert.equal(won.roll, 26);
  assert.equal(won.won, true);
  assert.equal(won.closed, false);
  assert.equal(won.credits, 18);
});

test("percent is not capped", () => {
  const alwaysLose = habitability(
    { percent: 95, credits: 5, variable: 1 },
    false,
    scripted([unit(5, 10), 0, unit(100, 101)]),
  );
  assert.equal(alwaysLose.percent, 120);
  assert.equal(alwaysLose.roll, 100);
  assert.equal(alwaysLose.won, false);
  assert.equal(alwaysLose.credits, 5);
  assert.equal(alwaysLose.variable, 1);

  const alwaysWin = habitability(
    { percent: 5, credits: 0, variable: 3 },
    true,
    scripted([unit(0, 101)]),
  );
  assert.equal(alwaysWin.percent, -20);
  assert.equal(alwaysWin.roll, 0);
  assert.equal(alwaysWin.won, true);
  assert.equal(alwaysWin.variable, 3);

  const zeroLoses = habitability(
    { percent: 25, credits: 0, variable: 1 },
    true,
    scripted([unit(0, 101)]),
  );
  assert.equal(zeroLoses.percent, 0);
  assert.equal(zeroLoses.roll, 0);
  assert.equal(zeroLoses.won, false);

  const zeroWins = habitability(
    { percent: 25, credits: 0, variable: 1 },
    true,
    scripted([unit(1, 101)]),
  );
  assert.equal(zeroWins.roll, 1);
  assert.equal(zeroWins.won, true);
});

test("wrong answer applies one multiplier and pays nothing", () => {
  const result = habitability(
    { percent: 40, credits: 20, variable: 1 },
    false,
    scripted([unit(0, 10), 0.5, unit(100, 101)]),
  );
  assert.equal(result.percent, 65);
  assert.equal(result.credits, 20);
  assert.equal(result.multiplier, 0.5);
  assert.equal(result.variable, 1);
  assert.equal(result.roll, 100);
  assert.equal(result.won, false);
  assert.equal(result.closed, true);
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

test("a hop is cheapest when two planets line up and dearest on opposite sides of the sun", () => {
  const p = PLANETS.find((x) => planetsOf(x.system).length >= 2);
  const q = planetsOf(p.system).find((x) => x.id !== p.id);
  const start = orbitAt(p, 0);
  const round = orbitAt(p, p.period);
  assert.ok(Math.abs(start.x - round.x) < 1e-6 && Math.abs(start.y - round.y) < 1e-6, "an orbit repeats after one period");
  assert.ok(Math.abs(Math.hypot(start.x, start.y) - p.orbit) < 1e-9);
  assert.equal(closestHop(p.id, q.id), Math.abs(p.orbit - q.orbit));
  assert.equal(closestHop(p.system, q.id), JUMP_R - q.orbit);
  let lo = Infinity;
  let hi = 0;
  for (let ms = 0; ms < 400_000; ms += 250) {
    const d = hopDistance(p.id, q.id, ms);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  assert.ok(lo >= Math.abs(p.orbit - q.orbit) - 1e-9 && lo < Math.abs(p.orbit - q.orbit) + 5, `closest ${lo}`);
  assert.ok(hi <= p.orbit + q.orbit + 1e-9 && hi > p.orbit + q.orbit - 5, `farthest ${hi}`);
  assert.equal(hopPower(220), 4.4);
  assert.equal(hopPower(123), 2.5);
});

test("eight different fuel rounds, and every card has one right answer among four", async () => {
  const { FUEL_ROUNDS } = await import("./fuelRounds.js");
  assert.equal(new Set(FUEL_ROUNDS.map((r) => r.id)).size, 8);
  const value = (s) => (s.endsWith("%") ? parseFloat(s) / 100 : s.includes("/") ? s.split("/")[0] / s.split("/")[1] : Number(s));
  const checks = {
    ink: (c) => assert.notEqual(c.answer.toUpperCase(), c.prompt),
    tank: (c) => assert.equal(c.answer, String(Math.max(...c.choices.map(Number)))),
    odd: (c) => {
      const rest = c.choices.filter((x) => x !== c.answer).map(value);
      assert.ok(rest.every((v) => Math.abs(v - rest[0]) < 1e-9), c.choices.join(" "));
      assert.ok(Math.abs(value(c.answer) - rest[0]) > 1e-9, c.choices.join(" "));
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

test("a scan's second site settles only when its roll beats the percent", () => {
  const half = () => 0.5; // rollInt(0, 100) → 50
  assert.equal(secondSite(49, half), true);
  assert.equal(secondSite(50, half), false);
  assert.equal(secondSite(-5, () => 0), true);
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
