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

const MOON_CHANCE = 0.35;
const MOON_TILT = 0.4;
const hundredth = (v) => Math.round(v * 100) / 100;

/**
 * The moons of a planet with the given id and map radius: usually none; otherwise one, sometimes two,
 * { r (orbit radius), size, speed (radians a second, signed for the way round), phase }, all in the
 * planet's own units. A ringed planet has none, since its rings would be in their way.
 */
export function moonsOf(id, radius, ringed) {
  if (ringed) return [];
  const rand = rng(hashId(`moons:${id}`));
  if (rand() >= MOON_CHANCE) return [];
  const count = rand() < 0.3 ? 2 : 1;
  return Array.from({ length: count }, (_, i) => ({
    r: tenth(radius + 6 + i * 5 + rand() * 2),
    size: tenth(2.2 + rand() * 1.4),
    // One lap takes 9 to 20 seconds.
    speed: hundredth(((rand() < 0.5 ? 1 : -1) * 2 * Math.PI) / (9 + rand() * 11)),
    phase: hundredth(rand() * 2 * Math.PI),
  }));
}

/** Where a moon is at wall-clock ms: x and y round its planet (squashed like the orbits), and whether it is on the near side. */
export function moonAt(moon, ms) {
  const a = moon.phase + (moon.speed * ms) / 1000;
  const y = Math.sin(a) * moon.r * MOON_TILT;
  return { x: Math.cos(a) * moon.r, y, front: y >= 0 };
}
