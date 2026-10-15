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

test("map is the bidirectional three-shell web", () => {
  assert.deepEqual(INNER, ["Earth", "Andoria", "Tellar", "Denobula"]);
  assert.deepEqual(MIDDLE, ["Bajor", "Betazed", "Trill", "Orion"]);
  assert.deepEqual(OUTER, ["Qo'noS", "Romulus", "Cardassia", "Ferenginar"]);

  function assertDist(a, b, distance) {
    const hits = LINKS.filter(
      (edge) =>
        (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
    );
    assert.equal(hits.length, 1, `${a}–${b}`);
    assert.equal(hits[0].distance, distance);
  }

  function assertUnlinked(a, b) {
    const hit = LINKS.some(
      (edge) =>
        (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
    );
    assert.equal(hit, false, `${a}–${b}`);
  }

  for (const planet of INNER) assertDist(STATION, planet, 10);
  assert.equal(LINKS.filter((edge) => edge.a === STATION || edge.b === STATION).length, 4);

  for (const names of [INNER, MIDDLE, OUTER]) {
    for (let i = 0; i < names.length; i++) {
      assertDist(names[i], names[(i + 1) % names.length], 8);
    }
  }

  for (const [a, b] of [
    ["Earth", "Bajor"],
    ["Earth", "Betazed"],
    ["Andoria", "Betazed"],
    ["Andoria", "Trill"],
    ["Tellar", "Trill"],
    ["Tellar", "Orion"],
    ["Denobula", "Orion"],
    ["Denobula", "Bajor"],
    ["Bajor", "Qo'noS"],
    ["Bajor", "Romulus"],
    ["Betazed", "Romulus"],
    ["Betazed", "Cardassia"],
    ["Trill", "Cardassia"],
    ["Trill", "Ferenginar"],
    ["Orion", "Ferenginar"],
    ["Orion", "Qo'noS"],
  ]) {
    assertDist(a, b, 12);
  }

  for (const planet of [...INNER, ...MIDDLE]) assertDist(DELTA_VEGA, planet, 8);
  for (const planet of [...MIDDLE, ...OUTER]) assertDist(CETI_ALPHA, planet, 8);
  for (const planet of [...OUTER, STATION, CETI_ALPHA]) assertUnlinked(DELTA_VEGA, planet);
  for (const planet of [...INNER, STATION]) assertUnlinked(CETI_ALPHA, planet);

  assert.equal(LINKS.length, 48);

  for (const edge of LINKS) {
    const forward = linksFrom(edge.a).find((next) => next.id === edge.b);
    const back = linksFrom(edge.b).find((next) => next.id === edge.a);
    assert.equal(forward.distance, edge.distance);
    assert.equal(back.distance, edge.distance);
  }

  const open = destinations(STATION, ["Earth"]);
  assert.deepEqual(
    open.map((next) => next.id).sort(),
    ["Andoria", "Denobula", "Tellar"],
  );
});

test("svg positions share angles across shells", () => {
  for (const [names, shell, r] of [
    [INNER, "inner", 1],
    [MIDDLE, "middle", 2],
    [OUTER, "outer", 3],
  ]) {
    names.forEach((id, i) => {
      const placed = node(id);
      assert.equal(placed.shell, shell);
      assert.equal(placed.r, r);
      assert.equal(placed.angle, -Math.PI / 2 + (i * Math.PI) / 2);
    });
  }
  assert.equal(node(STATION).r, 0);
  assert.equal(node(STATION).shell, "station");
  assert.equal(node(DELTA_VEGA).shell, "fuel");
  assert.equal(node(DELTA_VEGA).r, 1.5);
  assert.equal(node(CETI_ALPHA).shell, "fuel");
  assert.equal(node(CETI_ALPHA).r, 2.5);
  assert.equal(NODES.length, 15);
});
