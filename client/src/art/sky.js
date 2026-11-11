import { hashId, rng } from "./rng.js";

// A solar system's extras, every one seeded by the system's id so a visit looks the same each time: an
// asteroid belt between two of its orbits, moons round some planets, and comets that cross it now and
// then. Pure maths, no drawing: MapArt draws them and the tests check their rules. None of it changes
// how the game plays.

const BELT_CHANCE = 0.4;
const BELT_SPECKS = 150;
const tenth = (v) => Math.round(v * 10) / 10;

/**
 * The asteroid belt of a system with the given planet orbit radii (sorted, inner first), or null.
 * About two in five systems with at least two planets have one, in the middle 60% of one gap between
 * orbits so no planet ever flies through it. Specks are laid out on the flat plane, as
 * { x, y, r (size), o (opacity) }; the map tilts the whole belt like its orbits.
 */
export function beltOf(id, orbits) {
  if (orbits.length < 2) return null;
  const rand = rng(hashId(`belt:${id}`));
  if (rand() >= BELT_CHANCE) return null;
  const gap = Math.floor(rand() * (orbits.length - 1));
  const mid = (orbits[gap] + orbits[gap + 1]) / 2;
  const half = (orbits[gap + 1] - orbits[gap]) * 0.3;
  const specks = Array.from({ length: BELT_SPECKS }, () => {
    const a = rand() * 2 * Math.PI;
    const d = mid + (rand() - 0.5) * 2 * half;
    return { x: tenth(d * Math.cos(a)), y: tenth(d * Math.sin(a)), r: tenth(0.8 + rand() ** 2 * 2), o: tenth(0.45 + rand() * 0.5) };
  });
  return { gap, mid, half, specks };
}
