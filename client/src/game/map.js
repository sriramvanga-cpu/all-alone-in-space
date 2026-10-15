// Undirected star web. Angle is radians: slot 0 at the top (-π/2), then
// clockwise when drawn as x = r*cos(angle), y = r*sin(angle) with SVG y-down.
// r is a unit shell radius; scale it in the UI. The station sits at the origin.

export const INNER = Object.freeze(["Earth", "Andoria", "Tellar", "Denobula"]);
export const MIDDLE = Object.freeze(["Bajor", "Betazed", "Trill", "Orion"]);
export const OUTER = Object.freeze([
  "Qo'noS",
  "Romulus",
  "Cardassia",
  "Ferenginar",
]);

export const STATION = "station";
export const DELTA_VEGA = "Delta Vega";
export const CETI_ALPHA = "Ceti Alpha";

export const SHELL_RADIUS = Object.freeze({
  station: 0,
  inner: 1,
  middle: 2,
  outer: 3,
});

const links = [];

function link(a, b, distance) {
  links.push(Object.freeze({ a, b, distance }));
}

function ring(names) {
  for (let i = 0; i < names.length; i++) {
    link(names[i], names[(i + 1) % names.length], 8);
  }
}

for (const planet of INNER) link(STATION, planet, 10);
ring(INNER);
ring(MIDDLE);
ring(OUTER);

for (const [a, b] of [
  ["Earth", "Bajor"],
  ["Earth", "Betazed"],
  ["Andoria", "Betazed"],
  ["Andoria", "Trill"],
  ["Tellar", "Trill"],
  ["Tellar", "Orion"],
  ["Denobula", "Orion"],
  ["Denobula", "Bajor"],
]) {
  link(a, b, 12);
}

for (const [a, b] of [
  ["Bajor", "Qo'noS"],
  ["Bajor", "Romulus"],
  ["Betazed", "Romulus"],
  ["Betazed", "Cardassia"],
  ["Trill", "Cardassia"],
  ["Trill", "Ferenginar"],
  ["Orion", "Ferenginar"],
  ["Orion", "Qo'noS"],
]) {
  link(a, b, 12);
}

for (const planet of [...INNER, ...MIDDLE]) link(DELTA_VEGA, planet, 8);
for (const planet of [...MIDDLE, ...OUTER]) link(CETI_ALPHA, planet, 8);

export const LINKS = Object.freeze(links);

function placed(names, shell) {
  const r = SHELL_RADIUS[shell];
  return names.map((id, i) =>
    Object.freeze({
      id,
      shell,
      r,
      angle: -Math.PI / 2 + (i * Math.PI) / 2,
    }),
  );
}

export const NODES = Object.freeze([
  Object.freeze({
    id: STATION,
    shell: "station",
    r: SHELL_RADIUS.station,
    angle: 0,
  }),
  ...placed(INNER, "inner"),
  ...placed(MIDDLE, "middle"),
  ...placed(OUTER, "outer"),
  Object.freeze({ id: DELTA_VEGA, shell: "fuel", r: 1.5, angle: -Math.PI / 4 }),
  Object.freeze({
    id: CETI_ALPHA,
    shell: "fuel",
    r: 2.5,
    angle: (3 * Math.PI) / 4,
  }),
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
