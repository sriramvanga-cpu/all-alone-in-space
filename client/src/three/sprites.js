import * as THREE from "three";
import { loadTextures } from "./assets.js";
import { publishArt } from "./artStore.js";
import { NOISE } from "./glsl.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "./planetMaterial.js";
import { animateStarship, buildStarship, buildStation } from "./models.js";
import { glowSprite } from "./particles.js";
import { STAR_TINTS } from "../art/starTints.js";

// Renders the map's art once, with real textures and lights, into small images:
// every world (from its face), the ship from above, and the station from above.
// The SVG map then shows these images and keeps its own interactions.

const TEXTURES = {
  rock: ["mercury", "moon", "ceres", "haumea"],
  dust: ["venus", "makemake", "vulcan"],
  ice: ["eris", "haumea"],
  gas: ["jupiter", "saturn", "neptune", "uranus"],
};
const ATMO = { gas: 0.9, ice: 0.8, rock: 0.35, dust: 0.55 };
// Fuel stops take turns through worlds from the films; the fuel badge on the map marks them.
const FUEL_LOOKS = [
  { tex: ["makemake"], tint: "#ffe2b8", glow: "#ffcf8a", atmo: 0.5, relief: 6 }, // desert: Tatooine, Jakku
  { tex: ["eris", "haumea", "moon"], tint: "#e4f2ff", glow: "#bfe4ff", atmo: 0.9, relief: 4 }, // ice: Hoth, Rura Penthe
  { tex: ["mercury", "ceres"], tint: "#6a5650", glow: "#ff7a3a", atmo: 0.5, relief: 6, crack: 0.55 }, // lava: Mustafar
  { tex: ["moon", "ceres"], tint: "#3d7fd6", glow: "#8fd0ff", atmo: 1.0, relief: 1 }, // ocean: Kamino
  { tex: ["moon", "mercury"], tint: "#7cc064", glow: "#b8f0c0", atmo: 0.8, relief: 3 }, // jungle: Endor, Kashyyyk
  { tex: ["vulcan"], tint: "#ffc0a0", glow: "#ff9a70", atmo: 0.6, relief: 6 }, // red rock: Geonosis
  { tex: ["jupiter", "saturn"], tint: "#ffd0a8", glow: "#ffe0c0", atmo: 0.9, relief: 1.5, ring: true }, // gas giant: Bespin
  { tex: ["jupiter", "saturn"], tint: "#c8b0ff", glow: "#d8c8ff", atmo: 0.9, relief: 1.5 }, // violet giant
  { tex: ["jupiter", "saturn"], tint: "#c8e060", glow: "#e0ff80", atmo: 1.0, relief: 1.5 }, // toxic clouds: a Class Y world
];
const PLANET_PX = 256;
export const LIGHT = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function toUrl(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), "image/png"));
}

function tintFor(face) {
  const base = new THREE.Color(face.colors[0]);
  return new THREE.Color(1, 1, 1).lerp(base, face.kind === "gas" ? 0.3 : 0.45);
}

// Re-map a RingGeometry's UVs so u runs from the inner to the outer edge.
function ringUVs(geo, inner, outer) {
  const uv = geo.attributes.uv;
  const p = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
}

// A world's rank among the fuel stops (they take turns through FUEL_LOOKS), set once when the map art
// starts, so a live view of a fuel stop picks the same look as its map image.
const fuelRank = new Map();

/**
 * What a world looks like, as buildPlanet takes it: its texture, tint and glow, how thick its air is,
 * how rough its ground, and whether it has rings. Pure in the face, so the map image and a live view agree.
 */
export function lookOf(face, tex) {
  const h = hash(face.uid);
  const look = face.kind === "fuel" ? FUEL_LOOKS[(fuelRank.get(face.uid) ?? h) % FUEL_LOOKS.length] : null;
  const list = look?.tex || TEXTURES[face.kind] || TEXTURES.rock;
  return {
    map: tex[list[h % list.length]],
    tint: look ? new THREE.Color(look.tint) : tintFor(face),
    glow: look ? new THREE.Color(look.glow) : new THREE.Color(face.colors[2]),
    atmo: look?.atmo ?? ATMO[face.kind],
    relief: look?.relief ?? (face.kind === "gas" ? 1.5 : 6),
    crack: look?.crack ?? 0,
    ring: Boolean(face.ring || look?.ring),
    rimMix: face.kind === "ice" ? 0.5 : 0.15,
    spin: face.spin,
    tilt: face.tilt || 0,
  };
}

/**
 * A lit, textured world of radius 1 with its air and (if it has them) rings, as a group to add to a scene.
 * `spec` is a lookOf result; `ext` (how far a picture of it should reach, in radii) and the ring's
 * `ringIn` and `ringOut` can be set for pictures that need a tighter frame. Call dispose when done.
 */
export function buildPlanet(spec, tex) {
  const { map, tint, glow, atmo, relief, crack = 0, ring = false, rimMix = 0.15, spin = 0, tilt = 0, ringIn = 1.25, ringOut = 2.1 } = spec;
  const mat = makePlanetMaterial({ map, tint: [tint.r, tint.g, tint.b], relief });
  mat.uniforms.crack.value = crack;
  mat.uniforms.sunDir.value.copy(LIGHT);
  mat.uniforms.ambient.value = 0.02;
  mat.uniforms.rimStrength.value = 0.25 + 0.6 * atmo;
  mat.uniforms.rimColor.value = glow.clone().lerp(new THREE.Color("#9cc8ff"), rimMix);
  const bodyGeo = new THREE.SphereGeometry(1, 96, 48);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.rotation.set(0.3 - tilt * 0.01, (spin * Math.PI) / 180, tilt * 0.008);
  const group = new THREE.Group();
  group.add(body);
  const atm = makeAtmosphereMaterial({ radius: 1, top: 1.08, strength: atmo * 1.6 });
  atm.uniforms.sunDir.value.copy(LIGHT);
  atm.uniforms.lowColor.value = glow.clone().lerp(new THREE.Color("#ffffff"), 0.2);
  atm.uniforms.highColor.value = new THREE.Color("#7fb2ff");
  const airGeo = new THREE.SphereGeometry(1.08, 64, 32);
  group.add(new THREE.Mesh(airGeo, atm));
  const spare = [bodyGeo, airGeo, mat, atm];
  if (ring) {
    const ringGeo = new THREE.RingGeometry(ringIn, ringOut, 128, 1);
    ringUVs(ringGeo, ringIn, ringOut);
    const ringMat = new THREE.MeshStandardMaterial({ map: tex.ring, color: tint, transparent: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, depthWrite: false });
    const rings = new THREE.Mesh(ringGeo, ringMat);
    rings.rotation.set(-1.25, 0, (tilt * Math.PI) / 180);
    group.add(rings);
    spare.push(ringGeo, ringMat);
  }
  return { group, body, mat, atm, ext: spec.ext ?? (ring ? 2.2 : 1.22), dispose: () => spare.forEach((item) => item.dispose()) };
}

async function renderPlanets(renderer, faces, tex) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  cam.position.set(0, 0, 5);
  scene.add(new THREE.DirectionalLight("#ffffff", 2.4).translateOnAxis(LIGHT, 10));
  scene.add(new THREE.AmbientLight("#ffffff", 0.08));
  const planets = new Map();
  for (const face of faces) {
    const planet = buildPlanet(lookOf(face, tex), tex);
    scene.add(planet.group);
    cam.left = -planet.ext;
    cam.right = planet.ext;
    cam.top = planet.ext;
    cam.bottom = -planet.ext;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    planets.set(face.uid, { url: await toUrl(renderer.domElement), ext: planet.ext });
    scene.remove(planet.group);
    planet.dispose();
  }
  return planets;
}

// How each kind of star's surface boils: the size of its convection cells (more = finer), how much
// they stand out, and how spotty it is. Cool stars carry sunspots; hot and compact ones are smooth.
const STAR_LOOKS = {
  yellow: { cells: 14, contrast: 0.45, spots: 0.5 },
  orange: { cells: 12, contrast: 0.5, spots: 0.8 },
  red: { cells: 10, contrast: 0.45, spots: 1 },
  blue: { cells: 16, contrast: 0.3, spots: 0 },
  giant: { cells: 6, contrast: 0.5, spots: 0.7 },
  dwarf: { cells: 20, contrast: 0.18, spots: 0 },
  neutron: { cells: 22, contrast: 0.12, spots: 0 },
};
const STAR_PX = 320;
// The image reaches this far past the star's radius, for its rim of light.
const STAR_EXT = 1.32;

const STAR_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  vPos = position;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A star's surface works out how hot each spot is, then colours it from a ramp (deep limb colour →
// body → white-hot centre), so darker places read as cooler and redder rather than grey. The heat
// falls towards the edge (limb darkening), rises inside the fine convection cells and dips in the
// lanes between them, swirls in larger patches, sinks in sunspots on cool stars, and flares in
// bright flecks (faculae) near the limb.
const STAR_FRAG = /* glsl */ `
uniform vec3 hot;
uniform vec3 body;
uniform vec3 limb;
uniform float cellScale;
uniform float contrast;
uniform float spots;
uniform float seed;
varying vec3 vNormal;
varying vec3 vPos;
${NOISE}
vec3 ramp(float x) {
  vec3 c = mix(limb * 0.55, limb, smoothstep(0.0, 0.3, x));
  c = mix(c, body, smoothstep(0.25, 0.65, x));
  return mix(c, hot, smoothstep(0.65, 1.0, x));
}
void main() {
  float mu = clamp(vNormal.z, 0.0, 1.0);
  vec2 cell = cells(vPos * cellScale + seed);
  float granule = smoothstep(0.0, 0.4, cell.x) * (0.85 + 0.3 * cell.y);
  float swirl = fbm5(vPos * 3.0 + seed);
  float heat = 0.25 + 0.55 * pow(mu, 0.45);
  heat += contrast * ((granule - 0.55) * 0.5 + (swirl - 0.5) * 0.6);
  float blot = fbm3(vPos * 2.2 + seed * 3.1);
  heat -= spots * (0.18 * smoothstep(0.6, 0.66, blot) + 0.3 * smoothstep(0.68, 0.73, blot));
  heat += 0.12 * smoothstep(0.62, 0.78, fbm3(vPos * 5.0 + seed * 1.7)) * (1.0 - mu);
  vec3 col = ramp(clamp(heat, 0.0, 1.0)) * (0.9 + 0.25 * pow(mu, 2.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The thin rim of light just outside the disc, fading fast.
const HALO_FRAG = /* glsl */ `
uniform vec3 color;
uniform float ext;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0 * ext);
  gl_FragColor = vec4(color, exp(-max(r - 1.0, 0.0) * 10.0) * 0.85);
}`;

const HOLE_PX = 512;
// The black hole image reaches this many shadow radii from its centre.
const HOLE_EXT = 3.1;

// A black hole seen from just above its disk, on a flat card in units of the shadow's radius. Back
// to front: the far side of the disk bent by gravity over the top of the hole (and thinly under
// it), the far half of the disk, the black shadow, the photon ring hugging it, then the near half
// of the disk passing in front. The gas runs from white-hot inside to deep red outside in swirling
// streaks, brighter and hotter on the side coming towards us. Written premultiplied, as the
// canvas expects, so the PNG keeps its soft edges.
const HOLE_FRAG = /* glsl */ `
uniform float ext;
uniform float seed;
varying vec2 vUv;
${NOISE}
// Gas colour from the inner edge (t = 0) to the outer edge (t = 1).
vec3 heat(float t) {
  vec3 c = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.72, 0.3), smoothstep(0.0, 0.35, t));
  return mix(c, vec3(0.75, 0.22, 0.06), smoothstep(0.35, 1.0, t));
}
// Streaks along circles about the centre, wound into a loose spiral: u is the direction, d the
// distance. Sampled from the direction, not the angle, so there is no seam where the angle wraps.
float streaks(vec2 u, float d) {
  float a = 1.6 * log(d);
  vec2 w = mat2(cos(a), sin(a), -sin(a), cos(a)) * u;
  return smoothstep(0.25, 0.65, fbm3(vec3(w * 1.3, log(d) * 14.0 + seed)));
}
void over(inout vec3 col, inout float alpha, vec3 c, float a) {
  col = c * a + col * (1.0 - a);
  alpha = a + alpha * (1.0 - a);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * ext;
  float r = length(p);

  // The disk, squashed by the tilt: rd is the distance within its plane, side is +1 where it comes towards us.
  vec2 q = vec2(p.x, p.y / 0.28);
  float rd = max(length(q), 0.001);
  float side = -p.x / rd;
  float t = clamp((rd - 1.45) / 1.45 - 0.2 * side, 0.0, 1.0);
  float diskA = smoothstep(1.42, 1.48, rd) * (1.0 - smoothstep(2.4, 2.9, rd)) * (0.55 + 0.45 * (1.0 - t));
  vec3 disk = heat(t) * (0.55 + 0.75 * streaks(q / rd, rd)) * (1.0 + 0.55 * side);

  // The lensed far side: a broad arc over the top that thins to a fainter one underneath.
  float ar = max(length(vec2(p.x, p.y * 1.05)), 0.001);
  float arcSide = -p.x / ar;
  float outer = mix(1.3, 1.75, smoothstep(-0.6, 0.6, p.y));
  float arcA = smoothstep(1.05, 1.2, ar) * (1.0 - smoothstep(outer - 0.3, outer, ar)) * mix(0.35, 1.0, smoothstep(-0.3, 0.45, p.y));
  vec3 arc = heat(clamp((ar - 1.05) / 0.8 - 0.2 * arcSide, 0.0, 1.0)) * (0.65 + 0.6 * streaks(p / ar, ar + 0.4)) * (1.0 + 0.4 * arcSide);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  over(col, alpha, arc, arcA);
  over(col, alpha, disk, diskA * step(0.0, p.y));
  over(col, alpha, vec3(0.0), 1.0 - smoothstep(0.98, 1.02, r));
  over(col, alpha, vec3(1.0, 0.92, 0.75), 0.9 * exp(-pow((r - 1.04) / 0.035, 2.0)));
  over(col, alpha, disk, diskA * (1.0 - step(0.0, p.y)));
  // A soft orange glow beneath it all, gone before the card's edge.
  float glow = 0.25 * exp(-max(r - 1.0, 0.0) * 1.3) * (1.0 - smoothstep(2.4, 3.05, r)) * (1.0 - alpha);
  col += vec3(1.0, 0.55, 0.2) * glow;
  alpha += glow;
  gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
}`;

async function renderHole(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-HOLE_EXT, HOLE_EXT, HOLE_EXT, -HOLE_EXT, 0.1, 20);
  cam.position.set(0, 0, 5);
  const plane = new THREE.PlaneGeometry(2 * HOLE_EXT, 2 * HOLE_EXT);
  const mat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HOLE_FRAG,
    uniforms: { ext: { value: HOLE_EXT }, seed: { value: 3.7 } },
    blending: THREE.NoBlending,
  });
  scene.add(new THREE.Mesh(plane, mat));
  renderer.render(scene, cam);
  const url = await toUrl(renderer.domElement);
  plane.dispose();
  mat.dispose();
  return { url, ext: HOLE_EXT };
}

// A "#rrggbb" colour as raw 0–1 channels: the star shaders write colours as authored, with no colour
// management in between.
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// One image per kind of star, keyed by kind, framed STAR_EXT radii wide like the planet images.
async function renderStars(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-STAR_EXT, STAR_EXT, STAR_EXT, -STAR_EXT, 0.1, 20);
  cam.position.set(0, 0, 5);
  const sphere = new THREE.SphereGeometry(1, 96, 48);
  const plane = new THREE.PlaneGeometry(2 * STAR_EXT, 2 * STAR_EXT);
  const stars = new Map();
  for (const [kind, [hot, body, limb]] of Object.entries(STAR_TINTS)) {
    const look = STAR_LOOKS[kind];
    const surface = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        hot: { value: rgb(hot) },
        body: { value: rgb(body) },
        limb: { value: rgb(limb) },
        cellScale: { value: look.cells },
        contrast: { value: look.contrast },
        spots: { value: look.spots },
        seed: { value: (hash(kind) % 1000) / 10 },
      },
    });
    const halo = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { color: { value: rgb(body) }, ext: { value: STAR_EXT } },
      transparent: true,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(plane, halo);
    rim.position.z = -2;
    const ball = new THREE.Mesh(sphere, surface);
    ball.rotation.set(0.4, hash(kind) % 6, 0);
    scene.add(rim, ball);
    renderer.render(scene, cam);
    stars.set(kind, { url: await toUrl(renderer.domElement), ext: STAR_EXT });
    scene.remove(rim, ball);
    surface.dispose();
    halo.dispose();
  }
  sphere.dispose();
  plane.dispose();
  return stars;
}

const ROCK_PX = 128;
// The rock images reach this far past a rock's unit radius, for its bumps.
const ROCK_EXT = 1.4;

// Asteroids for the Asteroid tap fuel round: lumpy, cratered rocks, lit like the planets, each
// shaped by a few overlapping waves pushing its surface in and out.
async function renderRocks(renderer, tex) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-ROCK_EXT, ROCK_EXT, ROCK_EXT, -ROCK_EXT, 0.1, 20);
  cam.position.set(0, 0, 5);
  scene.add(new THREE.DirectionalLight("#ffffff", 3.2).translateOnAxis(LIGHT, 10));
  scene.add(new THREE.AmbientLight("#ffffff", 0.2));
  const maps = [tex.moon, tex.ceres, tex.mercury];
  const urls = [];
  const point = new THREE.Vector3();
  // A wave across the rock: big gentle ones make the potato shape, small ones roughen its skin.
  const wave = (freq, amp) => ({
    dir: new THREE.Vector3().randomDirection(),
    freq: freq[0] + Math.random() * (freq[1] - freq[0]),
    phase: Math.random() * Math.PI * 2,
    amp: amp[0] + Math.random() * (amp[1] - amp[0]),
  });
  for (let k = 0; k < 5; k++) {
    // An indexed sphere, so the bumps get smooth normals instead of flat facets.
    const geo = new THREE.SphereGeometry(1, 72, 48);
    const pos = geo.attributes.position;
    const waves = [
      ...Array.from({ length: 4 }, () => wave([1.5, 3.5], [0.06, 0.12])),
      ...Array.from({ length: 6 }, () => wave([6, 12], [0.01, 0.025])),
    ];
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i).normalize();
      let r = 1;
      for (const w of waves) r += w.amp * Math.sin(point.dot(w.dir) * w.freq + w.phase);
      pos.setXYZ(i, point.x * r * 1.12, point.y * r * 0.86, point.z * r);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: maps[k % maps.length], color: "#cbb9a6", roughness: 1, metalness: 0 });
    const rock = new THREE.Mesh(geo, mat);
    rock.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(rock);
    renderer.render(scene, cam);
    urls.push(await toUrl(renderer.domElement));
    scene.remove(rock);
    geo.dispose();
    mat.dispose();
  }
  return urls;
}

function topDown(renderer, object, half, pxW, pxH, env) {
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 1.2;
  scene.add(object);
  scene.add(new THREE.DirectionalLight("#fff4e6", 3).translateOnAxis(new THREE.Vector3(-0.5, 1, -0.6).normalize(), 100));
  scene.add(new THREE.HemisphereLight("#9fbaff", "#3a2a22", 0.6));
  const [hw, hh] = half;
  const cam = new THREE.OrthographicCamera(-hw[0], hw[1], hh, -hh, 0.1, 400);
  cam.position.set(0, 100, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  renderer.setSize(pxW, pxH, false);
  renderer.render(scene, cam);
  return toUrl(renderer.domElement);
}

// The ship from astern and a little above, for the warp tunnel: its nacelles and stern glow, and the key light
// comes from the left. Same units as topDown's view; the ship is about 46 long, so the camera sits 36 back.
function rearView(renderer, ship, env, pxW, pxH) {
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 1.4;
  scene.add(ship.group);
  scene.add(new THREE.DirectionalLight("#fff4e6", 2.4).translateOnAxis(new THREE.Vector3(-0.9, 0.8, 0.5).normalize(), 100));
  scene.add(new THREE.HemisphereLight("#9fbaff", "#3a2a22", 0.5));
  // Warp glow at each nacelle's stern and a warmer one at the hangar.
  for (const [x, y, z, size, color] of [[-11.6, 2.6, -8.16, 11, "#7fc8ff"], [-11.6, 2.6, 8.16, 11, "#7fc8ff"], [-10.8, -1.2, 0, 6, "#ffd9a0"]]) {
    const glow = glowSprite(color, size);
    glow.position.set(x, y, z);
    scene.add(glow);
  }
  const cam = new THREE.PerspectiveCamera(32, pxW / pxH, 1, 400);
  cam.position.set(-36, 7, 2);
  cam.lookAt(0, 0.5, 0);
  renderer.setSize(pxW, pxH, false);
  renderer.render(scene, cam);
  return toUrl(renderer.domElement);
}

// The eight planets of the Planet order cards, each as a picture, all drawn at one size with Saturn's ring tucked
// inside the frame, so the choices sit evenly in their tiles.
const WORLD_PX = 192;
const WORLD_EXT = 1.45;
const WORLD_LOOKS = {
  Mercury: { tex: "mercury", glow: "#c9c2ba", atmo: 0.1, relief: 6 },
  Venus: { tex: "saturn", tint: "#fff3d6", glow: "#fff0cf", atmo: 1, relief: 0.5, spin: 150 }, // cream cloud tops
  Earth: { tex: "earth", glow: "#8fc4ff", atmo: 1, relief: 1 },
  Mars: { tex: "mars", glow: "#ffb08a", atmo: 0.45, relief: 4 },
  Jupiter: { tex: "jupiter", glow: "#ffe0c0", atmo: 0.9, relief: 1.5 },
  Saturn: { tex: "saturn", glow: "#f3e2b4", atmo: 0.9, relief: 1.5, ring: true, tilt: -14 },
  Uranus: { tex: "uranus", tint: "#c8f2f4", glow: "#bff4f6", atmo: 1, relief: 1 },
  Neptune: { tex: "neptune", tint: "#9bb4ff", glow: "#9cc0ff", atmo: 1, relief: 1 },
};

async function renderWorlds(renderer, tex) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-WORLD_EXT, WORLD_EXT, WORLD_EXT, -WORLD_EXT, 0.1, 20);
  cam.position.set(0, 0, 5);
  scene.add(new THREE.DirectionalLight("#ffffff", 2.4).translateOnAxis(LIGHT, 10));
  scene.add(new THREE.AmbientLight("#ffffff", 0.08));
  const worlds = new Map();
  for (const [name, look] of Object.entries(WORLD_LOOKS)) {
    const planet = buildPlanet(
      {
        map: tex[look.tex],
        tint: new THREE.Color(look.tint ?? "#ffffff"),
        glow: new THREE.Color(look.glow),
        atmo: look.atmo,
        relief: look.relief,
        ring: Boolean(look.ring),
        ringIn: 1.17,
        ringOut: 1.42,
        ext: WORLD_EXT,
        spin: look.spin ?? 0,
        tilt: look.tilt ?? 0,
      },
      tex,
    );
    scene.add(planet.group);
    renderer.render(scene, cam);
    worlds.set(name, await toUrl(renderer.domElement));
    scene.remove(planet.group);
    planet.dispose();
  }
  return worlds;
}

let started = false;

// faces: an iterable of planet faces (art/Planet.jsx faceOf); images are keyed by face.uid.
export async function renderMapArt(faces) {
  if (started) return;
  started = true;
  // Fuel stops take their looks in order: note each one's place before anything awaits.
  const list = [...faces];
  list.filter((f) => f.kind === "fuel").forEach((f, i) => fuelRank.set(f.uid, i));
  const tex = await loadTextures();
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex.sky).texture;

    // Ship: same units as the SVG ship (viewBox -24 -11 46 22), seen from above.
    const ship = buildStarship();
    animateStarship(ship, 1, 0.5);
    const shipUrl = await topDown(renderer, ship.group, [[24, 22], 11], 736, 352, env);
    const shipRearUrl = await rearView(renderer, ship, env, 640, 400);

    // Station: same units as the SVG station (viewBox -40 -40 80 80).
    const station = buildStation();
    station.group.rotation.y = 0.3;
    const stationUrl = await topDown(renderer, station.group, [[40, 40], 40], 384, 384, env);
    publishArt({ ship: shipUrl, shipRear: shipRearUrl, station: stationUrl });

    renderer.setSize(STAR_PX, STAR_PX, false);
    const stars = await renderStars(renderer);
    renderer.setSize(HOLE_PX, HOLE_PX, false);
    stars.set("hole", await renderHole(renderer));
    publishArt({ stars });

    renderer.setSize(PLANET_PX, PLANET_PX, false);
    const planets = await renderPlanets(renderer, list, tex);
    publishArt({ planets });

    renderer.setSize(WORLD_PX, WORLD_PX, false);
    publishArt({ worlds: await renderWorlds(renderer, tex) });

    renderer.setSize(ROCK_PX, ROCK_PX, false);
    publishArt({ rocks: await renderRocks(renderer, tex) });
    pmrem.dispose();
  } finally {
    renderer.dispose();
  }
}
