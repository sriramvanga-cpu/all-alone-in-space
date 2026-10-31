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
  makeFuelCard,
  buyPacks,
  scanReadings,
  TOXIC_LIMIT,
} from "./rules.js";
import {
  INNER,
  MIDDLE,
  OUTER,
  STATION,
  DELTA_VEGA,
  CETI_ALPHA,
  LINKS,
  NODES,
  node,
  linksFrom,
  destinations,
  MAP_SEEDS,
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
  assert.equal(drawPercent("outer", rolls(58, 95, 70, 60)), 60);
  assert.equal(drawPercent("outer", rolls(58, 95, 58, 95)), 58);
  assert.throws(() => drawPercent("fuel"));
});

test("a right answer settles rarely near the station and often far out", () => {
  let s = 99;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const rate = (shell) => {
    let wins = 0;
    for (let i = 0; i < 4000; i++) {
      if (habitability({ percent: drawPercent(shell, rng), credits: 0, variable: 1 }, true, rng).won) wins++;
    }
    return wins / 4000;
  };
  const inner = rate("inner");
  const middle = rate("middle");
  const outer = rate("outer");
  assert.ok(inner < 0.1, `inner ${inner}`);
  assert.ok(middle > inner + 0.15 && middle < outer - 0.15, `middle ${middle}`);
  assert.ok(outer > 0.45, `outer ${outer}`);
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
  assert.ok(skilled > 0.55, `skilled ${skilled}`);
  assert.ok(guesser < 0.3, `guesser ${guesser}`);
  assert.ok(skilled - guesser > 0.3, `${skilled} vs ${guesser}`);
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

test("fuel cards are fresh arithmetic, not one fixed list", () => {
  const prompts = new Set();
  for (let i = 0; i < 40; i++) {
    const card = makeFuelCard();
    prompts.add(card.prompt);
    const [left, op, right] = card.prompt.split(" ");
    const a = Number(left);
    const b = Number(right);
    const expect = op === "+" ? a + b : op === "−" ? a - b : a * b;
    assert.equal(card.answer, String(expect));
    assert.equal(new Set(card.choices).size, 4);
    assert.ok(card.choices.includes(card.answer));
  }
  assert.ok(prompts.size >= 30, `only ${prompts.size} distinct prompts`);
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
  ]);
  assert.equal(START_FUEL, 10);
  assert.equal(START_CREDITS, 0);
  assert.equal(START_VARIABLE, 1);

  const oneOfEach = buyPacks({ credits: 53, fuel: 1 }, [1, 1, 1]);
  assert.deepEqual(oneOfEach, { ok: true, credits: 0, fuel: 31, cost: 53 });

  const twoSmall = buyPacks({ credits: 20, fuel: 0 }, [2, 0, 0]);
  assert.equal(twoSmall.ok, true);
  assert.equal(twoSmall.credits, 0);
  assert.equal(twoSmall.fuel, 10);

  const keep = buyPacks({ credits: 7, fuel: 4 }, [0, 0, 0]);
  assert.deepEqual(keep, { ok: true, credits: 7, fuel: 4, cost: 0 });

  const poor = buyPacks({ credits: 24, fuel: 3 }, [0, 0, 1]);
  assert.deepEqual(poor, { ok: false, credits: 24, fuel: 3, cost: 25 });

  const negative = buyPacks({ credits: 100, fuel: 0 }, [-1, 0, 0]);
  assert.equal(negative.ok, false);
  assert.equal(negative.credits, 100);
  assert.equal(negative.fuel, 0);
});

test("map is a sparse three-shell web", () => {
  assert.deepEqual(INNER, ["Earth", "Risa", "Andoria", "P'Jem", "Tellar", "Denobula"]);
  assert.deepEqual(MIDDLE, ["Bajor", "Deneb", "Betazed", "Khitomer", "Trill", "Orion"]);
  assert.deepEqual(OUTER, ["Qo'noS", "Nimbus", "Romulus", "Remus", "Cardassia", "Ferenginar"]);
  assert.equal(node("Vulcan"), null);

  const meanR = (shell) => {
    const rs = NODES.filter((n) => n.shell === shell);
    return rs.reduce((sum, n) => sum + n.r, 0) / rs.length;
  };
  const nearMiddle = (meanR("inner") + meanR("middle")) / 2;
  const nearOuter = (meanR("middle") + meanR("outer")) / 2;
  const bandOf = (id) => {
    const n = node(id);
    if (n.shell === "inner") return 8;
    if (n.shell === "middle") return 12;
    if (n.shell === "outer") return 16;
    if (n.r < nearMiddle) return 8;
    if (n.r < nearOuter) return 12;
    return 16;
  };
  const hopOf = (a, b) => {
    if (a === STATION || b === STATION) {
      const other = a === STATION ? b : a;
      return other === "Earth" || other === "Andoria" || other === "Denobula" ? 10 : bandOf(other);
    }
    return node(a).r >= node(b).r ? bandOf(a) : bandOf(b);
  };

  const station = linksFrom(STATION);
  const homes = station.filter((next) => node(next.id).shell === "inner");
  const pumps = station.filter((next) => node(next.id).shell === "fuel");
  assert.deepEqual(homes.map((next) => next.id).sort(), ["Andoria", "Denobula", "Earth"]);
  for (const next of homes) assert.equal(next.distance, 10);
  assert.equal(pumps.length, 3);
  for (const next of pumps) assert.equal(next.distance, hopOf(STATION, next.id), next.id);

  for (const [names, distance] of [
    [INNER, 8],
    [MIDDLE, 12],
    [OUTER, 16],
  ]) {
    let gaps = 0;
    for (let i = 0; i < names.length; i++) {
      const next = linksFrom(names[i]).find((hop) => hop.id === names[(i + 1) % names.length]);
      if (!next) gaps += 1;
      else assert.equal(next.distance, distance, `${names[i]} ring`);
    }
    assert.equal(gaps, 1, names[0]);
  }

  for (const id of [...INNER, ...MIDDLE, ...OUTER]) {
    const degree = linksFrom(id).length;
    assert.ok(degree >= 2 && degree <= 4, `${id} ${degree}`);
    const fuels = linksFrom(id).filter((next) => node(next.id).shell === "fuel");
    assert.equal(fuels.length, 1, id);
    assert.equal(fuels[0].distance, hopOf(id, fuels[0].id), id);
  }

  for (const id of [DELTA_VEGA, CETI_ALPHA]) {
    assert.equal(node(id).shell, "fuel");
    assert.ok(node(id).r > 1 && node(id).r < 4.05, id);
  }

  const crosses = LINKS.filter((edge) => {
    const shells = [node(edge.a).shell, node(edge.b).shell];
    return shells.every((shell) => shell === "inner" || shell === "middle" || shell === "outer") && shells[0] !== shells[1];
  });
  assert.equal(crosses.length, 5);
  for (const edge of crosses) {
    const shells = [node(edge.a).shell, node(edge.b).shell].sort();
    assert.equal(edge.distance, shells[1] === "outer" ? 16 : 12, `${edge.a}-${edge.b}`);
  }
  assert.equal(new Set(crosses.map((edge) => edge.distance)).size, 2);

  const fuels = NODES.filter((n) => n.shell === "fuel");
  assert.equal(fuels.length, 36);
  assert.equal(INNER.length + MIDDLE.length + OUTER.length, 18);
  for (const fuel of fuels) {
    const hops = linksFrom(fuel.id);
    assert.ok(hops.length >= 2 && hops.length <= 4, `${fuel.id} ${hops.length}`);
    for (const hop of hops) assert.equal(hop.distance, hopOf(fuel.id, hop.id), `${fuel.id}-${hop.id}`);
  }

  const radii = new Set(fuels.map((n) => n.r.toFixed(2)));
  assert.ok(radii.size > 8, "fuel worlds sit on a pattern");
  for (const fuel of fuels) {
    assert.ok(fuel.r > 1 && fuel.r < 4.05, fuel.id);
    const nearest = Math.min(
      ...[...INNER, ...MIDDLE, ...OUTER].map((id) => {
        const home = node(id);
        const dx = fuel.r * Math.cos(fuel.angle) - home.r * Math.cos(home.angle);
        const dy = fuel.r * Math.sin(fuel.angle) - home.r * Math.sin(home.angle);
        return Math.hypot(dx, dy);
      }),
    );
    assert.ok(nearest < 0.96, `${fuel.id} is outside the habitable gaps`);
  }

  const tank = new Map([[STATION, START_FUEL]]);
  const fuelQueue = [STATION];
  while (fuelQueue.length) {
    const id = fuelQueue.pop();
    let have = tank.get(id);
    if (node(id).shell === "fuel") have = Math.max(have, START_FUEL);
    for (const hop of linksFrom(id)) {
      const cost = fuelCost(1, hop.distance);
      if (have + 1e-9 < cost) continue;
      let arrive = have - cost;
      if (node(hop.id).shell === "fuel") arrive = Math.max(arrive, START_FUEL);
      if ((tank.get(hop.id) ?? -1) >= arrive) continue;
      tank.set(hop.id, arrive);
      fuelQueue.push(hop.id);
    }
  }
  for (const place of NODES) assert.ok(tank.has(place.id), `${place.id} is not visitable`);

  for (const edge of LINKS) {
    const forward = linksFrom(edge.a).find((next) => next.id === edge.b);
    const back = linksFrom(edge.b).find((next) => next.id === edge.a);
    assert.equal(forward.distance, edge.distance);
    assert.equal(back.distance, edge.distance);
  }

  function walk(steps) {
    for (let i = 0; i < steps.length - 1; i++) {
      assert.ok(linksFrom(steps[i]).some((next) => next.id === steps[i + 1]), `${steps[i]}–${steps[i + 1]}`);
    }
  }
  walk([STATION, "Denobula", "Orion", "Ferenginar"]);
  walk([STATION, "Andoria", "P'Jem", "Betazed", "Khitomer", "Remus"]);

  const seen = new Set([STATION]);
  const queue = [STATION];
  while (queue.length) {
    const id = queue.pop();
    for (const next of linksFrom(id)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      queue.push(next.id);
    }
  }
  for (const place of NODES) assert.ok(seen.has(place.id), place.id);

  const open = destinations(STATION, ["Earth"]);
  const openIds = open.map((next) => next.id);
  assert.ok(openIds.includes("Andoria") && openIds.includes("Denobula"));
  assert.equal(openIds.filter((id) => node(id).shell === "fuel").length, 3);
  assert.equal(openIds.includes("Earth"), false);
});

test("every map in the set is equally fair", async () => {
  const real = Math.random;
  const maps = [];
  for (let i = 0; i < MAP_SEEDS.length; i++) {
    Math.random = () => (i + 0.5) / MAP_SEEDS.length; // the load-time pick lands on seed i
    try {
      maps.push(await import(`./map.js?m=${i}`));
    } finally {
      Math.random = real;
    }
  }
  assert.equal(new Set(maps.map((m) => JSON.stringify(m.LINKS))).size, MAP_SEEDS.length);
  for (const [i, m] of maps.entries()) {
    const seed = MAP_SEEDS[i];
    // Cheapest route from the station to the outer ring, refuelling only at fuel worlds.
    const cost = new Map([[m.STATION, 0]]);
    const hops = new Map([[m.STATION, 0]]);
    const todo = new Set([m.STATION]);
    let outer = null;
    while (todo.size) {
      const id = [...todo].reduce((a, b) => (cost.get(a) <= cost.get(b) ? a : b));
      todo.delete(id);
      const shell = m.shellOf(id);
      if (shell === "outer") {
        outer = id;
        break;
      }
      if (id !== m.STATION && shell !== "fuel") continue;
      for (const hop of m.linksFrom(id)) {
        const c = cost.get(id) + fuelCost(1, hop.distance);
        if (cost.has(hop.id) && cost.get(hop.id) <= c) continue;
        cost.set(hop.id, c);
        hops.set(hop.id, hops.get(id) + 1);
        todo.add(hop.id);
      }
    }
    assert.ok(outer, `seed ${seed} reaches the outer ring`);
    assert.equal(hops.get(outer) - 1, 3, `seed ${seed} fuel stops`);
    assert.ok(cost.get(outer) >= 24 && cost.get(outer) <= 26, `seed ${seed} costs ${cost.get(outer)}`);

    const seen = new Set([m.STATION]);
    const queue = [m.STATION];
    while (queue.length) {
      for (const next of m.linksFrom(queue.pop())) {
        if (!seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next.id);
        }
      }
    }
    assert.equal(seen.size, m.NODES.length, `seed ${seed} reaches every world`);
  }
});

test("planets keep shells and sit off perfect circles", () => {
  const radii = (names) => names.map((id) => node(id).r);
  const avg = (xs) => xs.reduce((sum, n) => sum + n, 0) / xs.length;
  for (const [names, shell] of [
    [INNER, "inner"],
    [MIDDLE, "middle"],
    [OUTER, "outer"],
  ]) {
    for (const id of names) assert.equal(node(id).shell, shell);
    const rs = radii(names);
    assert.ok(Math.max(...rs) - Math.min(...rs) > 0.2, shell);
    const angles = names.map((id) => node(id).angle);
    assert.ok(
      angles.some((angle, i) => angle !== -Math.PI / 2 + (i * Math.PI) / 2),
      shell,
    );
  }
  assert.ok(avg(radii(INNER)) < avg(radii(MIDDLE)));
  assert.ok(avg(radii(MIDDLE)) < avg(radii(OUTER)));
  assert.equal(node(STATION).r, 0);
  assert.equal(node(STATION).shell, "station");
  assert.equal(node(DELTA_VEGA).shell, "fuel");
  assert.equal(node(CETI_ALPHA).shell, "fuel");
  assert.equal(NODES.length, 55);
});
