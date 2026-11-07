import * as THREE from "three";
import { loadTextures } from "./assets.js";
import { publishArt } from "./artStore.js";
import { NOISE } from "./glsl.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "./planetMaterial.js";
import { animateStarship, buildStarship, buildStation } from "./models.js";
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
const LIGHT = new THREE.Vector3(-0.62, 0.55, 0.56).normalize();

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

async function renderPlanets(renderer, faces, tex) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  cam.position.set(0, 0, 5);
  scene.add(new THREE.DirectionalLight("#ffffff", 2.4).translateOnAxis(LIGHT, 10));
  scene.add(new THREE.AmbientLight("#ffffff", 0.08));
  const sphere = new THREE.SphereGeometry(1, 96, 48);
  const planets = new Map();
  let fuelN = 0;
  for (const face of faces) {
    const h = hash(face.uid);
    const look = face.kind === "fuel" ? FUEL_LOOKS[fuelN++ % FUEL_LOOKS.length] : null;
    const list = look?.tex || TEXTURES[face.kind] || TEXTURES.rock;
    const map = tex[list[h % list.length]];
    const tint = look ? new THREE.Color(look.tint) : tintFor(face);
    const atmo = look?.atmo ?? ATMO[face.kind];
    const glow = look ? new THREE.Color(look.glow) : new THREE.Color(face.colors[2]);
    const mat = makePlanetMaterial({ map, tint: [tint.r, tint.g, tint.b], relief: look?.relief ?? (face.kind === "gas" ? 1.5 : 6) });
    mat.uniforms.crack.value = look?.crack ?? 0;
    mat.uniforms.sunDir.value.copy(LIGHT);
    mat.uniforms.ambient.value = 0.02;
    mat.uniforms.rimStrength.value = 0.25 + 0.6 * atmo;
    mat.uniforms.rimColor.value = glow.clone().lerp(new THREE.Color("#9cc8ff"), face.kind === "ice" ? 0.5 : 0.15);
    const body = new THREE.Mesh(sphere, mat);
    body.rotation.set(0.3 - (face.tilt || 0) * 0.01, (face.spin * Math.PI) / 180, (face.tilt || 0) * 0.008);
    const group = new THREE.Group();
    group.add(body);
    const atm = makeAtmosphereMaterial({ radius: 1, top: 1.08, strength: atmo * 1.6 });
    atm.uniforms.sunDir.value.copy(LIGHT);
    atm.uniforms.lowColor.value = glow.clone().lerp(new THREE.Color("#ffffff"), 0.2);
    atm.uniforms.highColor.value = new THREE.Color("#7fb2ff");
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32), atm));
    let ext = 1.22;
    let ringGeo = null;
    if (face.ring || look?.ring) {
      ext = 2.2;
      ringGeo = new THREE.RingGeometry(1.25, 2.1, 128, 1);
      ringUVs(ringGeo, 1.25, 2.1);
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshStandardMaterial({ map: tex.ring, color: tint, transparent: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, depthWrite: false }),
      );
      ring.rotation.set(-1.25, 0, ((face.tilt || 0) * Math.PI) / 180);
      group.add(ring);
    }
    scene.add(group);
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    planets.set(face.uid, { url: await toUrl(renderer.domElement), ext });
    scene.remove(group);
    mat.dispose();
    ringGeo?.dispose();
  }
  sphere.dispose();
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

let started = false;

// faces: an iterable of planet faces (art/Planet.jsx faceOf); images are keyed by face.uid.
export async function renderMapArt(faces) {
  if (started) return;
  started = true;
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

    // Station: same units as the SVG station (viewBox -40 -40 80 80).
    const station = buildStation();
    station.group.rotation.y = 0.3;
    const stationUrl = await topDown(renderer, station.group, [[40, 40], 40], 384, 384, env);
    publishArt({ ship: shipUrl, station: stationUrl });

    renderer.setSize(STAR_PX, STAR_PX, false);
    publishArt({ stars: await renderStars(renderer) });

    renderer.setSize(PLANET_PX, PLANET_PX, false);
    const planets = await renderPlanets(renderer, faces, tex);
    publishArt({ planets });

    renderer.setSize(ROCK_PX, ROCK_PX, false);
    publishArt({ rocks: await renderRocks(renderer, tex) });
    pmrem.dispose();
  } finally {
    renderer.dispose();
  }
}
