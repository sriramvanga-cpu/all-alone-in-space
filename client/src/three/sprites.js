import * as THREE from "three";
import { loadTextures } from "./assets.js";
import { publishArt } from "./artStore.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "./planetMaterial.js";
import { animateStarship, buildStarship, buildStation } from "./models.js";

// Renders the map's art once, with real textures and lights, into small images:
// every world (from its face), the ship from above, and the station from above.
// The SVG map then shows these images and keeps its own interactions.

const TEXTURES = {
  rock: ["mercury", "moon", "ceres", "haumea"],
  dust: ["venus", "makemake", "vulcan"],
  ice: ["eris", "haumea"],
  gas: ["jupiter", "saturn", "neptune", "uranus"],
  fuel: ["jupiter", "saturn"],
};
const ATMO = { gas: 0.9, ice: 0.8, fuel: 1.0, rock: 0.35, dust: 0.55 };
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
  if (face.kind === "fuel") return new THREE.Color(1, 1, 1).lerp(new THREE.Color("#ffb040"), 0.55);
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
  for (const face of faces) {
    const h = hash(face.uid);
    const list = TEXTURES[face.kind] || TEXTURES.rock;
    const map = tex[list[h % list.length]];
    const tint = tintFor(face);
    const mat = makePlanetMaterial({ map, tint: [tint.r, tint.g, tint.b], relief: face.kind === "gas" || face.kind === "fuel" ? 1.5 : 6 });
    mat.uniforms.sunDir.value.copy(LIGHT);
    mat.uniforms.ambient.value = 0.02;
    mat.uniforms.rimStrength.value = 0.25 + 0.6 * ATMO[face.kind];
    mat.uniforms.rimColor.value = new THREE.Color(face.colors[2]).lerp(new THREE.Color("#9cc8ff"), face.kind === "ice" ? 0.5 : 0.15);
    const body = new THREE.Mesh(sphere, mat);
    body.rotation.set(0.3 - (face.tilt || 0) * 0.01, (face.spin * Math.PI) / 180, (face.tilt || 0) * 0.008);
    const group = new THREE.Group();
    group.add(body);
    const atm = makeAtmosphereMaterial({ radius: 1, top: 1.08, strength: ATMO[face.kind] * 1.6 });
    atm.uniforms.sunDir.value.copy(LIGHT);
    atm.uniforms.lowColor.value = new THREE.Color(face.colors[2]).lerp(new THREE.Color("#ffffff"), 0.2);
    atm.uniforms.highColor.value = new THREE.Color("#7fb2ff");
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32), atm));
    let ext = 1.22;
    let ringGeo = null;
    if (face.ring) {
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

    renderer.setSize(PLANET_PX, PLANET_PX, false);
    const planets = await renderPlanets(renderer, faces, tex);
    publishArt({ planets });
    pmrem.dispose();
  } finally {
    renderer.dispose();
  }
}
