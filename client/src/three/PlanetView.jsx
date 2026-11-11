import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadTextures } from "./assets.js";
import { animateShuttle, animateStarship, buildShuttle, buildStarship } from "./models.js";
import { LIGHT, buildPlanet, lookOf } from "./sprites.js";
import { glowSprite } from "./particles.js";

// Two live views of a world, each drawn into a transparent canvas that fills its box:
// - "orbit": the planet turning slowly with the player's ship circling it, for the screens at a world;
// - "landing": the film of the shuttle's descent to the ground, the readings' scan ring, and the sky and haze
//   taking on the verdict's colour. It follows the wall clock (landing.at), so it needs no state from the screens
//   over it.
// The caller keeps the planet's still picture (or the plain backdrop) under either, for the moments before the first
// frame and if WebGL can't start.

const FRAME_MS = 1000 / 30;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export default function PlanetView({ face, mode = "orbit", landing, onReady, onFail }) {
  const box = useRef(null);
  const calls = useRef({});
  calls.current = { onReady, onFail };
  const film = useRef(landing);
  useEffect(() => {
    let dead = false;
    let stop = () => {};
    loadTextures()
      .then((tex) => {
        if (dead) return;
        stop = (mode === "landing" ? startLanding : startOrbit)(box.current, face, tex, calls.current, film.current);
      })
      .catch(() => calls.current.onFail?.());
    return () => {
      dead = true;
      stop();
    };
  }, [face.uid, mode]);
  return <div className={mode === "landing" ? "planet-view film" : "planet-view"} ref={box} aria-hidden="true" />;
}

function makeRenderer(el, maxRatio) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(maxRatio, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);
  return renderer;
}

// Keeps the canvas and the camera's aspect matched to the box.
function fitTo(el, renderer, cam) {
  const resize = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  resize();
  const watch = new ResizeObserver(resize);
  watch.observe(el);
  return () => watch.disconnect();
}

function lit(renderer, tex, sun, strength) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 1.2;
  const key = new THREE.DirectionalLight("#ffffff", strength);
  key.position.copy(sun).multiplyScalar(10);
  scene.add(key, new THREE.AmbientLight("#ffffff", 0.08));
  return { scene, key, pmrem };
}

// --- The planet with the ship circling it ----------------------------------------------------------------

// The starship is about 46 units long and its middle is 3.5 units ahead of its origin; scaled so it is
// 0.65 of a planet radius long.
const SHIP_SCALE = 0.65 / 46;
const SHIP_MID = 3.5;

function startOrbit(el, face, tex, calls) {
  const renderer = makeRenderer(el, 1.5);
  if (!renderer) {
    calls.onFail?.();
    return () => {};
  }
  const spec = lookOf(face, tex);
  const planet = buildPlanet(spec, tex);
  // Half the view's height, and the ship's orbit, in planet radii: ringed worlds need more room.
  const reach = spec.ring ? 2.5 : 1.7;
  const orbit = spec.ring ? 2.35 : 1.45;

  const { scene, pmrem } = lit(renderer, tex, LIGHT, 2.4);
  scene.add(planet.group);

  const ship = buildStarship();
  animateStarship(ship, 0.45, 0);
  ship.group.scale.setScalar(SHIP_SCALE);
  ship.group.position.x = -SHIP_MID * SHIP_SCALE;
  const pivot = new THREE.Group();
  pivot.add(ship.group);
  scene.add(pivot);

  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  cam.position.set(0, 0, reach / Math.tan((cam.fov * Math.PI) / 360));
  cam.lookAt(0, 0, 0);
  const unfit = fitTo(el, renderer, cam);

  // The orbit is a circle tilted towards the viewer, so the ship passes in front of the planet and then behind it.
  const tilt = new THREE.Euler(0.5, 0, -0.32);
  const up = new THREE.Vector3(0, 1, 0).applyEuler(tilt);
  const at = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let t = 0;
  let last = 0;
  let raf = 0;
  let shown = false;
  const frame = (ms) => {
    raf = requestAnimationFrame(frame);
    if (ms - last < FRAME_MS) return;
    const dt = Math.min(0.1, (ms - last) / 1000);
    last = ms;
    t += dt;
    planet.body.rotation.y += dt * 0.15;
    const a = t * 0.5;
    at.set(Math.cos(a) * orbit, 0, Math.sin(a) * orbit).applyEuler(tilt);
    ahead.set(-Math.sin(a), 0, Math.cos(a)).applyEuler(tilt);
    side.crossVectors(ahead, up);
    pivot.quaternion.setFromRotationMatrix(basis.makeBasis(ahead, up, side));
    pivot.position.copy(at);
    animateStarship(ship, 0.45, t);
    renderer.render(scene, cam);
    if (!shown) {
      shown = true;
      calls.onReady?.();
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    unfit();
    planet.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

// --- The landing film ------------------------------------------------------------------------------------

// The planet has radius 1 and the landing site is straight up from its middle. The camera drops from CAM_FROM to
// CAM_TO above the site while looking at a spot SITE_ARC radians along the ground, where the shuttle lands; the
// shuttle sits on the line of sight, nearer the camera at first and on the ground at the end. Aiming at a spot on the
// ground makes the camera tip from looking straight down on a globe to looking over the ground at the horizon.
const SUN = new THREE.Vector3(-0.55, 0.7, 0.35).normalize();
const CAM_FROM = 2;
const CAM_TO = 0.055;
const SITE_ARC = 0.12;
const SHUTTLE_SCALE = 0.03;
// How far the shuttle is from the camera at the start, and at the end when it is on the ground.
const SHUTTLE_FAR = 0.45;
const RING_MS = 900;
// Sky, rim light and ground haze after the verdict: air for a world that can be lived on, smog for one that can't.
const VERDICT = {
  habitable: { low: "#59ffb8", high: "#4dd9ff", haze: 0, sun: 3.2 },
  toxic: { low: "#ff5f38", high: "#cc4d40", haze: 0.7, sun: 2.4, hazeColor: "#a8432a" },
};

const RING_FRAG = /* glsl */ `
uniform float uR;
uniform float uA;
varying vec3 vP;
void main() {
  float ang = acos(clamp(vP.y, -1.0, 1.0));
  float line = smoothstep(0.02, 0.0, abs(ang - uR));
  float glow = smoothstep(0.09, 0.0, abs(ang - uR)) * 0.4;
  gl_FragColor = vec4(vec3(0.25, 0.8, 1.0) * (line * 1.6 + glow) * uA, 1.0);
}
`;

function startLanding(el, face, tex, calls, landing) {
  const renderer = makeRenderer(el, 1.25);
  if (!renderer) {
    calls.onFail?.();
    return () => {};
  }
  const base = lookOf(face, tex);
  const planet = buildPlanet({ ...base, ring: false }, tex);
  // Gas giants have no ground to roughen, and the grit that suits rock would make their clouds look like carpet.
  const grit = face.kind === "gas" ? 0.12 : 1;
  const air = planet.atm.uniforms.strength.value;
  // An equator patch of the texture at the site, turned by the world's own spin so each world lands somewhere different.
  planet.body.rotation.set(Math.PI / 2, ((face.spin || 0) * Math.PI) / 180, 0);
  planet.mat.uniforms.sunDir.value.copy(SUN);
  planet.atm.uniforms.sunDir.value.copy(SUN);
  planet.mat.uniforms.hazeDist.value = 0.4;
  const baseLow = planet.atm.uniforms.lowColor.value.clone();
  const baseHigh = planet.atm.uniforms.highColor.value.clone();
  const baseRim = planet.mat.uniforms.rimColor.value.clone();

  const { scene, key, pmrem } = lit(renderer, tex, SUN, 2.6);
  scene.add(planet.group);

  const shuttle = buildShuttle();
  shuttle.group.scale.setScalar(SHUTTLE_SCALE);
  const pivot = new THREE.Group();
  pivot.add(shuttle.group);
  scene.add(pivot);
  // Engine glows (in the shuttle's own units), and the glow of its thrust on the ground.
  const flames = shuttle.aft.map((p) => {
    const flame = glowSprite("#ffb070", 0.7);
    flame.position.copy(p);
    shuttle.group.add(flame);
    return flame;
  });
  const pad = glowSprite("#ffd9a0", 0.2);
  scene.add(pad);

  // The scan ring: a cap of the planet's skin round the landing spot, lit as a thin ring that grows and fades.
  const site = new THREE.Vector3(0, Math.cos(SITE_ARC), -Math.sin(SITE_ARC));
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uR: { value: 0 }, uA: { value: 0 } },
    vertexShader: "varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: RING_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const capGeo = new THREE.SphereGeometry(1.004, 96, 24, 0, Math.PI * 2, 0, 0.7);
  const cap = new THREE.Group();
  cap.add(new THREE.Mesh(capGeo, ringMat));
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), site);
  scene.add(cap);
  pad.position.copy(site).multiplyScalar(1.004);

  const cam = new THREE.PerspectiveCamera(42, 1, 0.01, 30);
  const unfit = fitTo(el, renderer, cam);

  const camAt = new THREE.Vector3();
  const sight = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const lowNow = new THREE.Color();
  const highNow = new THREE.Color();
  const rimNow = new THREE.Color();
  const endAt = landing.at + landing.descentMs;
  const verdict = VERDICT[landing.habitable ? "habitable" : "toxic"];
  const toLow = new THREE.Color(verdict.low);
  const toHigh = new THREE.Color(verdict.high);
  let last = 0;
  let raf = 0;
  let shown = false;
  const frame = (ms) => {
    raf = requestAnimationFrame(frame);
    const now = Date.now();
    const u = clamp((now - landing.at) / landing.descentMs);
    const quiet = now > landing.verdictAt + 1800;
    // Full rate while it descends, then half, then an occasional frame once the scene has settled.
    if (ms - last < (u < 1 ? 0 : quiet ? 120 : FRAME_MS)) return;
    last = ms;

    // The camera drops, fast at first and slowing as it nears the ground.
    const e = 1 - (1 - u) * (1 - u);
    const h = lerp(CAM_FROM, CAM_TO, e);
    camAt.set(0, 1 + h, 0);
    const since = now - endAt;
    if (since > 0) camAt.y += Math.exp(-since / 140) * 0.003 * Math.sin(since * 0.07);
    cam.position.copy(camAt);
    sight.copy(site).sub(camAt);
    const sightLength = sight.length();
    sight.normalize();
    cam.up.set(0, -sight.z, sight.y).normalize();
    cam.lookAt(site);
    planet.mat.uniforms.detail.value = grit * (1 - smooth(0.1, 0.5, h));
    // Seen from inside, the thin air would saturate to white at the horizon, so it thins as the camera comes down.
    planet.atm.uniforms.strength.value = air * (0.3 + 0.7 * smooth(0.05, 0.5, h));

    // The shuttle is on the line of sight: 0.45 from the camera at the start, on the ground at the end.
    const endLength = Math.hypot(1 + CAM_TO - site.y, site.z);
    pivot.position.copy(camAt).addScaledVector(sight, Math.min(sightLength, lerp(SHUTTLE_FAR, endLength, e)));
    radial.copy(pivot.position).normalize();
    // The shuttle's origin is a little above its belly, so it rests on the ground and not in it.
    pivot.position.addScaledVector(radial, 0.0055);
    forward.set(0, 0, -1).addScaledVector(radial, radial.z);
    forward.normalize();
    // Turned a little off the camera's line, so the shuttle shows more than its roof and stern.
    forward.applyAxisAngle(radial, 0.4);
    side.crossVectors(forward, radial);
    pivot.quaternion.setFromRotationMatrix(basis.makeBasis(forward, radial, side));
    // The thrust cuts out half a second after touchdown.
    const thrust = since < 0 ? 1 : Math.max(0, 1 - since / 500);
    animateShuttle(shuttle, thrust, now / 1000);
    for (const flame of flames) flame.scale.setScalar(0.05 + 0.5 * thrust);
    pad.scale.setScalar(0.2 * smooth(0.6, 1, u) * thrust + 0.001);

    // The scan ring pulses out from the landing spot while the readings come in.
    const pulse = now - endAt;
    const scanning = pulse > 0 && now < landing.verdictAt + RING_MS * 0.4;
    const along = (pulse % RING_MS) / RING_MS;
    // The ground is hidden past the horizon, about 0.3 from the camera, so the ring only needs to travel that far.
    ringMat.uniforms.uR.value = 0.03 + 0.3 * along;
    ringMat.uniforms.uA.value = scanning ? 1 - 0.8 * along : 0;

    // After the verdict the sky, the rim light and the ground haze take its colour.
    const tint = smooth(0, 1200, now - landing.verdictAt);
    planet.atm.uniforms.lowColor.value.copy(lowNow.copy(baseLow).lerp(toLow, tint));
    planet.atm.uniforms.highColor.value.copy(highNow.copy(baseHigh).lerp(toHigh, tint));
    planet.mat.uniforms.rimColor.value.copy(rimNow.copy(baseRim).lerp(toLow, tint * 0.6));
    planet.mat.uniforms.hazeAmount.value = verdict.haze * tint;
    if (verdict.hazeColor) planet.mat.uniforms.hazeColor.value.set(verdict.hazeColor);
    key.intensity = lerp(2.6, verdict.sun, tint);

    renderer.render(scene, cam);
    if (!shown) {
      shown = true;
      calls.onReady?.();
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    unfit();
    planet.dispose();
    capGeo.dispose();
    ringMat.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
