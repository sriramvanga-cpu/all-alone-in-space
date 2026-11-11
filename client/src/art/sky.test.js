import assert from "node:assert/strict";
import test from "node:test";
import { beltOf, cometAt, cometOf, moonAt, moonsOf } from "./sky.js";

const ids = Array.from({ length: 300 }, (_, i) => `system-${i}`);

test("a belt sits inside one gap between orbits, so no planet flies through it", () => {
  const orbits = [100, 165, 230];
  let belts = 0;
  for (const id of ids) {
    const belt = beltOf(id, orbits);
    if (!belt) continue;
    belts++;
    for (const s of belt.specks) {
      const d = Math.hypot(s.x, s.y);
      assert.ok(d > orbits[belt.gap] + 10 && d < orbits[belt.gap + 1] - 10, `${id}: speck at ${d}`);
    }
  }
  // About two in five systems have one.
  assert.ok(belts > ids.length * 0.25 && belts < ids.length * 0.55, `${belts} belts`);
  assert.equal(beltOf("lonely", [100]), null);
  // The same id always gives the same belt.
  assert.deepEqual(beltOf(ids[0], orbits), beltOf(ids[0], orbits));
});

test("moons stay clear of their planet and in front or behind by which side of the orbit they are on", () => {
  let withMoons = 0;
  for (const id of ids) {
    const moons = moonsOf(id, 12, false);
    if (moons.length) withMoons++;
    assert.ok(moons.length <= 2, id);
    for (const m of moons) {
      assert.ok(m.r > 12 + 5 && m.r < 12 + 14, `${id}: orbit ${m.r}`);
      assert.ok(m.size >= 2.2 && m.size <= 3.6, `${id}: size ${m.size}`);
      for (const ms of [0, 1234, 98765]) {
        const at = moonAt(m, ms);
        assert.ok(Math.hypot(at.x, at.y / 0.4) > 12 + 5, `${id}: too close`);
        assert.equal(at.front, at.y >= 0);
      }
    }
  }
  assert.ok(withMoons > ids.length * 0.2 && withMoons < ids.length * 0.5, `${withMoons} planets with moons`);
  assert.deepEqual(moonsOf("ringed", 12, true), []);
});

test("a comet misses the sun, its tail points away from it, and it only crosses in the first 8 seconds of a slot", () => {
  let slots = 0;
  let total = 0;
  for (const id of ids) {
    for (let cycle = 0; cycle < 10; cycle++) {
      total++;
      const c = cometOf(id, cycle);
      if (!c) continue;
      slots++;
      assert.ok(Math.abs(c.miss) >= 90 && Math.abs(c.miss) <= 180, `${id}: miss ${c.miss}`);
      for (const u of [0, 0.2, 0.5, 0.8, 0.99]) {
        const at = cometAt(id, cycle * 30_000 + u * 8_000);
        assert.ok(at, `${id}: no comet at ${u}`);
        assert.ok(Math.hypot(at.x, at.y) >= 90, `${id}: ${Math.hypot(at.x, at.y)} from the sun`);
        assert.ok(at.tx * at.x + at.ty * at.y > 0, `${id}: tail points at the sun`);
      }
      assert.equal(cometAt(id, cycle * 30_000 + 8_000), null);
      assert.equal(cometAt(id, cycle * 30_000 + 29_000), null);
    }
  }
  assert.ok(slots > total * 0.3 && slots < total * 0.5, `${slots} of ${total} slots`);
});
