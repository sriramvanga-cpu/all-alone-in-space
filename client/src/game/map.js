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

const links = [];

function link(a, b, distance) {
  links.push(Object.freeze({ a, b, distance }));
}

function brokenRing(names) {
  for (let i = 0; i < names.length - 1; i++) link(names[i], names[i + 1], 8);
}

for (const planet of ["Earth", "Andoria", "Denobula"]) link(STATION, planet, 10);
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
  link(a, b, 12);
}

for (const planet of ["Earth", "Risa", "Deneb"]) link(DELTA_VEGA, planet, 8);
for (const planet of ["Trill", "Cardassia", "Ferenginar"]) link(CETI_ALPHA, planet, 8);

export const LINKS = Object.freeze(links);

function at(id, shell, r, angle) {
  return Object.freeze({ id, shell, r, angle });
}

export const NODES = Object.freeze([
  at(STATION, "station", 0, 0),
  at("Earth", "inner", 0.74, -2.55),
  at("Risa", "inner", 1.2, -1.5),
  at("Andoria", "inner", 0.86, -0.45),
  at("P'Jem", "inner", 1.3, 0.6),
  at("Tellar", "inner", 0.96, 1.65),
  at("Denobula", "inner", 1.12, 2.7),
  at("Bajor", "middle", 1.7, -2.1),
  at("Deneb", "middle", 2.25, -1.05),
  at("Betazed", "middle", 1.82, 0),
  at("Khitomer", "middle", 2.38, 1.05),
  at("Trill", "middle", 1.9, 2.1),
  at("Orion", "middle", 2.2, 3.15),
  at("Qo'noS", "outer", 2.68, -2.33),
  at("Nimbus", "outer", 3.4, -1.28),
  at("Romulus", "outer", 2.85, -0.23),
  at("Remus", "outer", 3.48, 0.82),
  at("Cardassia", "outer", 2.98, 1.87),
  at("Ferenginar", "outer", 3.25, 2.92),
  at(DELTA_VEGA, "fuel", 1.94, -1.39),
  at(CETI_ALPHA, "fuel", 2.82, 2.51),
]);

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
