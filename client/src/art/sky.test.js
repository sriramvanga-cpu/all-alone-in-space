import assert from "node:assert/strict";
import test from "node:test";
import { beltOf } from "./sky.js";

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
