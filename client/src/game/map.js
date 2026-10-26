// Undirected star web. Each world is hand-placed: x = r*cos(angle),
// y = r*sin(angle), SVG y-down. Shell is the habitability draw, not a shared orbit.
// Names in a shell run around the chart; the wrap-around is the one gap.
// The station sits at the origin.

export const INNER = Object.freeze([
  "Earth",
  "Risa",
  "Andoria",
  "P'Jem",
  "Tellar",
  "Denobula",
]);
export const MIDDLE = Object.freeze([
  "Bajor",
  "Deneb",
  "Betazed",
  "Khitomer",
  "Trill",
  "Orion",
]);
export const OUTER = Object.freeze([
  "Qo'noS",
  "Nimbus",
  "Romulus",
  "Remus",
  "Cardassia",
  "Ferenginar",
]);

export const STATION = "station";
export const DELTA_VEGA = "Delta Vega";
export const CETI_ALPHA = "Ceti Alpha";

const MORE_FUEL = Object.freeze([
  DELTA_VEGA, CETI_ALPHA,
  "Talos", "Organia", "Cestus", "Regula", "Deneva", "Tarsus", "Janus", "Sherman", "Mudd",
  "Capella", "Ardana", "Eminiar", "Neural", "Ekos", "Gideon", "Scalos", "Sarpeidon",
  "Argelius", "Melkot", "Minara", "Aldebaran", "Berengaria", "Izar", "Elas", "Troyius",
  "Cheron", "Coridan", "Rigel", "Altair", "Antares", "Vega", "Maluria", "Holberg", "Platonius",
]);

function at(id, shell, r, angle) {
  return Object.freeze({ id, shell, r, angle });
}

function dist2(a, b) {
  const dx = a.r * Math.cos(a.angle) - b.r * Math.cos(b.angle);
  const dy = a.r * Math.sin(a.angle) - b.r * Math.sin(b.angle);
  return dx * dx + dy * dy;
}

const HABITABLE = [
  ["Earth", "inner", 0.74, -2.55],
  ["Risa", "inner", 1.2, -1.5],
  ["Andoria", "inner", 0.86, -0.45],
  ["P'Jem", "inner", 1.3, 0.6],
  ["Tellar", "inner", 0.96, 1.65],
  ["Denobula", "inner", 1.12, 2.7],
  ["Bajor", "middle", 1.95, -2.1],
  ["Deneb", "middle", 2.5, -1.05],
  ["Betazed", "middle", 2.07, 0],
  ["Khitomer", "middle", 2.63, 1.05],
  ["Trill", "middle", 2.15, 2.1],
  ["Orion", "middle", 2.45, 3.15],
  ["Qo'noS", "outer", 3.48, -2.33],
  ["Nimbus", "outer", 4.2, -1.28],
  ["Romulus", "outer", 3.65, -0.23],
  ["Remus", "outer", 4.28, 0.82],
  ["Cardassia", "outer", 3.78, 1.87],
  ["Ferenginar", "outer", 4.05, 2.92],
].map(([id, shell, r, angle]) => at(id, shell, r, angle));

const meanR = (shell) => {
  const worlds = HABITABLE.filter((world) => world.shell === shell);
  return worlds.reduce((sum, world) => sum + world.r, 0) / worlds.length;
};
const nearMiddle = (meanR("inner") + meanR("middle")) / 2;
const nearOuter = (meanR("middle") + meanR("outer")) / 2;

function scatterFuel() {
  const placed = [];
  let guard = 0;
  while (placed.length < MORE_FUEL.length && guard < 8000) {
    guard += 1;
    const a = HABITABLE[Math.floor(Math.random() * HABITABLE.length)];
    let b = HABITABLE[Math.floor(Math.random() * HABITABLE.length)];
    if (a.id === b.id) continue;
    const t = 0.28 + Math.random() * 0.44;
    const ax = a.r * Math.cos(a.angle);
    const ay = a.r * Math.sin(a.angle);
    const bx = b.r * Math.cos(b.angle);
    const by = b.r * Math.sin(b.angle);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const j = (Math.random() - 0.5) * 0.45;
    const x = ax + dx * t + (-dy / len) * j;
    const y = ay + dy * t + (dx / len) * j;
    const spot = { r: Math.hypot(x, y), angle: Math.atan2(y, x) };
    if (spot.r < 1.02 || spot.r > 4.02) continue;
    const near = Math.min(...HABITABLE.map((h) => dist2(spot, h)));
    if (near < 0.26 * 0.26 || near > 0.95 * 0.95) continue;
    if (placed.some((p) => dist2(spot, p) < 0.42 * 0.42)) continue;
    placed.push(at(MORE_FUEL[placed.length], "fuel", spot.r, spot.angle));
  }
  if (placed.length !== MORE_FUEL.length) throw new Error("could not place fuel worlds");
  return placed;
}

const extraFuel = scatterFuel();

export const NODES = Object.freeze([at(STATION, "station", 0, 0), ...HABITABLE, ...extraFuel]);

const atNode = new Map(NODES.map((n) => [n.id, n]));

const STATION_HOMES = ["Earth", "Andoria", "Denobula"];
const links = [];

function band(id) {
  if (INNER.includes(id)) return 8;
  if (MIDDLE.includes(id)) return 12;
  if (OUTER.includes(id)) return 16;
  const r = atNode.get(id).r;
  if (r < nearMiddle) return 8;
  if (r < nearOuter) return 12;
  return 16;
}

function hopDistance(a, b) {
  const spoke = a === STATION ? b : b === STATION ? a : null;
  if (spoke) return STATION_HOMES.includes(spoke) ? 10 : band(spoke);
  const farther = atNode.get(a).r >= atNode.get(b).r ? a : b;
  return band(farther);
}

function link(a, b) {
  links.push(Object.freeze({ a, b, distance: hopDistance(a, b) }));
}

function brokenRing(names) {
  for (let i = 0; i < names.length - 1; i++) link(names[i], names[i + 1]);
}

for (const planet of STATION_HOMES) link(STATION, planet);
brokenRing(INNER);
brokenRing(MIDDLE);
brokenRing(OUTER);
for (const [a, b] of [
  ["P'Jem", "Betazed"],
  ["Denobula", "Orion"],
  ["Bajor", "Qo'noS"],
  ["Khitomer", "Remus"],
  ["Orion", "Ferenginar"],
]) {
  link(a, b);
}

const fuelDegree = new Map(extraFuel.map((n) => [n.id, 0]));
function xy(id) {
  const n = atNode.get(id);
  return { x: n.r * Math.cos(n.angle), y: n.r * Math.sin(n.angle) };
}
function blocks(aId, bId) {
  const a = xy(aId);
  const b = xy(bId);
  return links.some((edge) => {
    if (edge.a === aId || edge.b === aId || edge.a === bId || edge.b === bId) return false;
    const c = xy(edge.a);
    const d = xy(edge.b);
    const o1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const o2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    const o3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
    const o4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
    return o1 * o2 < 0 && o3 * o4 < 0;
  });
}
function join(a, b) {
  link(a, b);
  if (fuelDegree.has(a)) fuelDegree.set(a, fuelDegree.get(a) + 1);
  if (fuelDegree.has(b)) fuelDegree.set(b, fuelDegree.get(b) + 1);
}

const parent = new Map(extraFuel.map((n) => [n.id, n.id]));
function find(id) {
  let root = id;
  while (parent.get(root) !== root) root = parent.get(root);
  return root;
}
function unite(a, b) {
  parent.set(find(a), find(b));
}

const pairs = [];
for (let i = 0; i < extraFuel.length; i++) {
  for (let j = i + 1; j < extraFuel.length; j++) {
    pairs.push([dist2(extraFuel[i], extraFuel[j]), extraFuel[i], extraFuel[j]]);
  }
}
pairs.sort((a, b) => a[0] - b[0]);
for (const [, a, b] of pairs) {
  if (find(a.id) === find(b.id)) continue;
  if (fuelDegree.get(a.id) >= 2 || fuelDegree.get(b.id) >= 2) continue;
  if (blocks(a.id, b.id)) continue;
  join(a.id, b.id);
  unite(a.id, b.id);
}
for (const [, a, b] of pairs) {
  if (find(a.id) === find(b.id)) continue;
  if (fuelDegree.get(a.id) >= 3 || fuelDegree.get(b.id) >= 3) continue;
  if (blocks(a.id, b.id)) continue;
  join(a.id, b.id);
  unite(a.id, b.id);
}
for (const [, a, b] of pairs) {
  if (find(a.id) === find(b.id)) continue;
  if (fuelDegree.get(a.id) >= 3 || fuelDegree.get(b.id) >= 3) continue;
  join(a.id, b.id);
  unite(a.id, b.id);
}

const usedFuel = new Set();
const homes = [...HABITABLE].sort((a, b) => a.id.localeCompare(b.id));
for (const home of homes) {
  let best = null;
  let bestScore = Infinity;
  for (const fuel of extraFuel) {
    if (usedFuel.has(fuel.id) || fuelDegree.get(fuel.id) >= 3 || blocks(home.id, fuel.id)) continue;
    const score = dist2(home, fuel);
    if (score < bestScore) {
      bestScore = score;
      best = fuel;
    }
  }
  if (!best) {
    for (const fuel of extraFuel) {
      if (usedFuel.has(fuel.id) || fuelDegree.get(fuel.id) >= 3) continue;
      const score = dist2(home, fuel);
      if (score < bestScore) {
        bestScore = score;
        best = fuel;
      }
    }
  }
  if (!best) throw new Error(`no fuel stop for ${home.id}`);
  usedFuel.add(best.id);
  join(home.id, best.id);
}

function alreadyLinked(a, b) {
  return links.some((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
}
for (const fuel of extraFuel) {
  if (fuelDegree.get(fuel.id) >= 2) continue;
  let best = null;
  let bestD = Infinity;
  for (const other of extraFuel) {
    if (other.id === fuel.id || alreadyLinked(fuel.id, other.id) || fuelDegree.get(other.id) >= 3) continue;
    if (blocks(fuel.id, other.id)) continue;
    const d = dist2(fuel, other);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  if (!best) {
    for (const other of extraFuel) {
      if (other.id === fuel.id || alreadyLinked(fuel.id, other.id) || fuelDegree.get(other.id) >= 3) continue;
      const d = dist2(fuel, other);
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
  }
  if (!best) throw new Error(`fuel stop ${fuel.id} is stranded`);
  join(fuel.id, best.id);
}

const gates = [...extraFuel].sort((a, b) => a.r - b.r);
const firstFuel = [];
for (const fuel of gates) {
  if (firstFuel.length === 3) break;
  if (blocks(STATION, fuel.id)) continue;
  firstFuel.push(fuel);
}
for (const fuel of gates) {
  if (firstFuel.length === 3) break;
  if (firstFuel.includes(fuel)) continue;
  firstFuel.push(fuel);
}
for (const fuel of firstFuel) link(STATION, fuel.id);

export const LINKS = Object.freeze(links);

export function node(id) {
  return NODES.find((n) => n.id === id) ?? null;
}

export function shellOf(id) {
  return node(id)?.shell ?? null;
}

export function linksFrom(id) {
  const out = [];
  for (const edge of LINKS) {
    if (edge.a === id) out.push({ id: edge.b, distance: edge.distance });
    else if (edge.b === id) out.push({ id: edge.a, distance: edge.distance });
  }
  return out;
}

/** Open destinations. A closed planet cannot be chosen; other links stay. */
export function destinations(from, closed = []) {
  const shut = new Set(closed);
  return linksFrom(from).filter((next) => !shut.has(next.id));
}
