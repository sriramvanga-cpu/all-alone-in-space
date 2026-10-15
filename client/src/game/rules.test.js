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
  drawMultiplier,
  applyMultiplier,
  habitability,
  fuelMinute,
  buyPacks,
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

test("shell percents: max, min, and half-up average", () => {
  const rolls = (x, y) => scripted([unit(x, 101), unit(y, 101)]);
  assert.equal(drawPercent("inner", rolls(55, 80)), 80);
  assert.equal(drawPercent("outer", rolls(55, 80)), 55);
  assert.equal(drawPercent("middle", rolls(20, 80)), 50);
  assert.equal(drawPercent("middle", rolls(2, 3)), 3);
  assert.equal(drawPercent("middle", rolls(0, 1)), 1);
  assert.equal(drawPercent("inner", rolls(0, 100)), 100);
  assert.equal(drawPercent("outer", rolls(0, 100)), 0);
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

test("applyMultiplier floors at 0.1", () => {
  assert.equal(applyMultiplier(2, 1.5), 3);
  assert.equal(applyMultiplier(0.4, 0.2), 0.1);
});

test("roll equal to percent does not win", () => {
  const state = { percent: 50, credits: 0, variable: 2 };
  const lost = habitability(state, true, scripted([unit(40, 101)]));
  assert.equal(state.percent, 50);
  assert.equal(lost.percent, 40);
  assert.equal(lost.roll, 40);
  assert.equal(lost.won, false);
  assert.equal(lost.closed, true);
  assert.equal(lost.credits, 15);
  assert.equal(lost.variable, 2);
  assert.equal(lost.multiplier, null);

  const won = habitability(
    { percent: 50, credits: 3, variable: 2 },
    true,
    scripted([unit(41, 101)]),
  );
  assert.equal(won.roll, 41);
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
  assert.equal(alwaysLose.percent, 105);
  assert.equal(alwaysLose.roll, 100);
  assert.equal(alwaysLose.won, false);
  assert.equal(alwaysLose.credits, 5);
  assert.equal(alwaysLose.variable, 1);

  const alwaysWin = habitability(
    { percent: 5, credits: 0, variable: 3 },
    true,
    scripted([unit(0, 101)]),
  );
  assert.equal(alwaysWin.percent, -5);
  assert.equal(alwaysWin.roll, 0);
  assert.equal(alwaysWin.won, true);
  assert.equal(alwaysWin.variable, 3);

  const zeroLoses = habitability(
    { percent: 10, credits: 0, variable: 1 },
    true,
    scripted([unit(0, 101)]),
  );
  assert.equal(zeroLoses.percent, 0);
  assert.equal(zeroLoses.roll, 0);
  assert.equal(zeroLoses.won, false);

  const zeroWins = habitability(
    { percent: 10, credits: 0, variable: 1 },
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
    scripted([unit(0, 10), 0.5, unit(50, 101)]),
  );
  assert.equal(result.percent, 50);
  assert.equal(result.credits, 20);
  assert.equal(result.multiplier, 0.5);
  assert.equal(result.variable, 0.5);
  assert.equal(result.roll, 50);
  assert.equal(result.won, false);
  assert.equal(result.closed, true);
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
  assert.equal(START_FUEL, 30);
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

  const station = linksFrom(STATION);
  assert.equal(station.length, 3);
  for (const next of station) {
    assert.equal(node(next.id).shell, "inner");
    assert.equal(next.distance, 10);
  }

  for (const names of [INNER, MIDDLE, OUTER]) {
    let gaps = 0;
    for (let i = 0; i < names.length; i++) {
      const next = linksFrom(names[i]).find((hop) => hop.id === names[(i + 1) % names.length]);
      if (!next) gaps += 1;
      else assert.equal(next.distance, 8, `${names[i]} ring`);
    }
    assert.equal(gaps, 1, names[0]);
  }

  for (const id of [...INNER, ...MIDDLE, ...OUTER]) {
    const degree = linksFrom(id).length;
    assert.ok(degree === 2 || degree === 3, `${id} ${degree}`);
  }

  const delta = linksFrom(DELTA_VEGA);
  assert.deepEqual(delta.map((next) => next.id).sort(), ["Deneb", "Earth", "Risa"]);
  for (const next of delta) {
    assert.ok(node(next.id).shell === "inner" || node(next.id).shell === "middle");
    assert.equal(next.distance, 8);
  }
  const ceti = linksFrom(CETI_ALPHA);
  assert.deepEqual(ceti.map((next) => next.id).sort(), ["Cardassia", "Ferenginar", "Trill"]);
  for (const next of ceti) {
    assert.ok(node(next.id).shell === "middle" || node(next.id).shell === "outer");
    assert.equal(next.distance, 8);
  }

  const crosses = LINKS.filter((edge) => {
    const shells = [node(edge.a).shell, node(edge.b).shell];
    return shells.every((shell) => shell === "inner" || shell === "middle" || shell === "outer") && shells[0] !== shells[1];
  });
  assert.equal(crosses.length, 5);
  for (const edge of crosses) assert.equal(edge.distance, 12);

  assert.equal(LINKS.length, 29);

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
  walk([STATION, "Earth", DELTA_VEGA, "Deneb", "Bajor", "Qo'noS"]);
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
  assert.deepEqual(
    open.map((next) => next.id).sort(),
    ["Andoria", "Denobula"],
  );
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
  assert.equal(NODES.length, 21);
});
