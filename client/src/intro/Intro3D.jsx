import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadTextures } from "../three/assets.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "../three/planetMaterial.js";
import { animateShuttle, animateStarship, buildShuttle, buildStarship } from "../three/models.js";
import { engine, sfx } from "../sound.js";
import { createComposer } from "../three/post.js";
import { ParticleSystem, glowSprite } from "../three/particles.js";
import { clamp, easeInOut, easeOut, rand, smooth } from "./draw.js";
import { DROP } from "../art/MapArt.jsx";

// The realistic intro: one unbroken camera move, no cuts.
//   Launch     sunrise on Vulcan as it breaks up: quakes, a glowing crack by the pad, eruptions on
//              the horizon, the last other ships climbing away; then the shuttle lifts off its pad.
//   Climb      the camera rides close behind it while Vulcan, veined with glowing cracks, curves away below.
//   Docking    the shuttle lines up behind the starship and flies into its stern hangar.
//   Escape     the camera sweeps over the ship as it banks away into open space.
//   Look back  from off the bow, Vulcan breaks apart behind the ship and the blast wave hits it.
//   Ahead      the camera comes round behind the ship as it vents air and life support fails; a
//              scan lights up the stars ahead, drawn like the star map, and the ship jumps to warp.
const LIFT = 3.0;
const CLIMB = 5.2;
const ALIGN = 9.4;
const DOCK = 11.8;
const JUMP = 12.4;
const ARRIVE = 15.4;
const BOOM = ARRIVE + 1.0;
const HIT = BOOM + 2.2;
const TURN = BOOM + 2.8;
const ALARM = HIT + 1.1;
const AHEAD = TURN + 2.6;
const SCAN = AHEAD + 0.1;
const ROUTE = SCAN + 2.0;
const WARP = ROUTE + 2.4;
const END = WARP + 1.5;

// The ground shakes at these moments before lift-off.
const QUAKES = [0.5, 2.1];

const CAPTIONS = [
  { from: 0.6, to: CLIMB - 0.5, title: "Vulcan is dying", text: "Its core is collapsing, and quakes are tearing the planet apart." },
  { from: CLIMB, to: DOCK + 0.4, title: "The last shuttle out", text: "Everyone else has fled. Your crew races for the starship in orbit." },
  { from: JUMP + 0.6, to: BOOM - 0.2, title: "Full speed away", text: "Vulcan has only seconds left." },
  { from: BOOM + 0.4, to: ALARM - 0.1, title: "Vulcan is gone", text: "Home is gone, and the blast has hit the ship." },
  { from: ALARM, to: SCAN + 1.6, title: "15 minutes of air", text: "Life support is failing. In 15 minutes the air runs out." },
  { from: SCAN + 1.8, to: END - 0.4, title: "Find a new home", text: "Fly from star to star. Land on a world marked ! before the air runs out." },
];

// The stars the ship's scan picks out ahead, in the ship's own frame once it has run clear (x ahead,
// y up, z to the side), drawn over the film like the star map: a fuel stop, and a world that could be home.
const HUD_STARS = [
  { at: [2600, 0, 0], color: "#dfe9ff" },
  { at: [3400, -250, 700], color: "#ffd27a", kind: "fuel", label: "Fuel stop" },
  { at: [5600, 600, -650], color: "#9fe7ff", kind: "home", label: "Possible home" },
  { at: [4600, 450, 1000], color: "#ffb48a" },
];
// Lanes between them (-1 is the ship), and the route that lights up: the ship, the first star, home.
const HUD_LANES = [[-1, 0], [-1, 1], [0, 2], [1, 3], [0, 3]];
const HUD_ROUTE = [[-1, 0], [0, 2]];
// Where the blast wave tore the saucer's rim (ship frame), and the way the air vents out of it.
const VENT = [7.9, 1.75, 6.06];
const VENT_OUT = [-0.5, 0.15, 0.87];

const RP = 1000;
const ATM_TOP = 1055;
const UP = new THREE.Vector3(0, 1, 0);
const EAST = new THREE.Vector3(1, 0, 0);
const PAD = new THREE.Vector3(0, RP, 0);
const SUN = new THREE.Vector3(0.75, 0.3, 0.6).normalize();
const SHIP_POS = new THREE.Vector3(330, RP + 430, -20);

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function captionAt(T) {
  return CAPTIONS.findIndex((c) => T >= c.from && T < c.to);
}

// Distance along a path over h seconds, given the speeds at both ends (cubic Hermite).
function hermite(d0, d1, v0, v1, u, h) {
  const x = clamp(u);
  const x2 = x * x;
  const x3 = x2 * x;
  return (2 * x3 - 3 * x2 + 1) * d0 + (x3 - 2 * x2 + x) * h * v0 + (3 * x2 - 2 * x3) * d1 + (x3 - x2) * h * v1;
}

// Orientation that points +X along `forward` with +Y as close to `up` as possible.
function facing(forward, up) {
  const x = forward.clone().normalize();
  const z = x.clone().cross(up).normalize();
  const y = z.clone().cross(x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  let s = seed;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const bumps = Array.from({ length: 6 }, () => [v3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.15 + r() * 0.35]);
  const v = v3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let k = 1;
    for (const [d, a] of bumps) k -= a * Math.max(0, v.dot(d)) ** 3;
    v.multiplyScalar(k * (0.85 + 0.3 * r()));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// A jagged crack across the ground, as a ribbon lying on the surface: three vertices wide, so its
// colour fades to nothing at both edges. Narrow at the ends, widest in the middle. The same seed
// gives the same path at any width, and `line` is its centre.
function fissure(seed, start, heading, steps, width) {
  let s = seed;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pos = [];
  const col = [];
  const index = [];
  const line = [];
  const p = start.clone();
  const d = heading.clone();
  for (let i = 0; i <= steps; i++) {
    const n = p.clone().normalize();
    const side = d.clone().cross(n).normalize();
    const w = width * Math.sin(Math.PI * (0.06 + (0.88 * i) / steps)) * (0.55 + 0.9 * r());
    const at = n.clone().multiplyScalar(RP + 0.03);
    line.push(at);
    for (const k of [-1, 0, 1]) {
      pos.push(...at.clone().addScaledVector(side, (k * w) / 2).toArray());
      col.push(...(k ? [0, 0, 0] : [1, 1, 1]));
    }
    if (i < steps) {
      const a = i * 3;
      index.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
    // Wander, but keep the same general way and flat on the ground.
    d.applyAxisAngle(n, (r() - 0.5) * 0.9).lerp(heading, 0.25);
    d.addScaledVector(n, -d.dot(n)).normalize();
    p.addScaledVector(d, 0.5 + 0.7 * r());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  return { geo, line };
}

export default function Intro3D({ onDone, onFail }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const doneRef = useRef(onDone);
  const failRef = useRef(onFail);
  doneRef.current = onDone;
  failRef.current = onFail;
  const hudRef = useRef(null);
  const [caption, setCaption] = useState(-1);
  const [alarm, setAlarm] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let cleanup = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      doneRef.current();
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("textures timed out")), 9000));
    Promise.race([loadTextures(), timeout])
      .then((tex) => {
        if (cancelled) return;
        cleanup = start(tex);
        setReady(true);
      })
      .catch((err) => {
        console.warn("3D intro unavailable, using the 2D intro:", err);
        if (!cancelled) failRef.current();
      });

    function start(tex) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const canvas = canvasRef.current;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", logarithmicDepthBuffer: true });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(pixelRatio);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromEquirectangular(tex.sky).texture;
      scene.environment = env;
      scene.environmentIntensity = 1.3;

      const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200000);

      // Sky: the Milky Way photo far away, plus crisp stars in front of it.
      const skyMat = new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, depthWrite: false, toneMapped: false });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 64, 32), skyMat);
      sky.renderOrder = -10;
      scene.add(sky);
      const starGeo = new THREE.BufferGeometry();
      const starPos = new Float32Array(3500 * 3);
      const starCol = new Float32Array(3500 * 3);
      for (let i = 0; i < 3500; i++) {
        const d = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(50000);
        starPos.set([d.x, d.y, d.z], i * 3);
        const warm = Math.random();
        const b = 0.45 + Math.random() ** 3 * 1.1;
        starCol.set([b * (0.8 + warm * 0.2), b * 0.88, b * (1.05 - warm * 0.25)], i * 3);
      }
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
      const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
      const stars = new THREE.Points(starGeo, starMat);
      stars.renderOrder = -9;
      scene.add(stars);

      // Sun: light plus a bright disc and a wide glow for bloom to catch.
      const sunLight = new THREE.DirectionalLight("#fff1dc", 3.0);
      sunLight.position.copy(SUN).multiplyScalar(10000);
      scene.add(sunLight, sunLight.target);
      const bounce = new THREE.HemisphereLight("#2a3456", "#8a4a2a", 1.4);
      scene.add(bounce);
      const sunCore = glowSprite("#fff6e4", 1);
      const sunHalo = glowSprite("#ffb070", 1);
      scene.add(sunCore, sunHalo);

      // Vulcan.
      const planetMat = makePlanetMaterial({ map: tex.vulcan, relief: 7, detail: 1, city: 1 });
      planetMat.uniforms.sunDir.value.copy(SUN);
      // The atmosphere shell draws the air here, so keep the shader's own rim faint.
      planetMat.uniforms.rimStrength.value = 0.12;
      const planet = new THREE.Mesh(new THREE.SphereGeometry(RP, 320, 160), planetMat);
      planet.rotation.set(-Math.PI / 2, 2.15, 0);
      scene.add(planet);
      const atmMat = makeAtmosphereMaterial({ radius: RP, top: ATM_TOP, strength: 1.0 });
      atmMat.uniforms.sunDir.value.copy(SUN);
      const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATM_TOP, 128, 64), atmMat);
      scene.add(atmosphere);

      // Landing pad with a ring of lights.
      const pad = new THREE.Group();
      pad.position.copy(PAD);
      const padMetal = new THREE.MeshStandardMaterial({ color: "#4a4a50", metalness: 0.3, roughness: 0.8 });
      const padDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.04, 64), padMetal);
      padDisc.position.y = 0.0;
      pad.add(padDisc);
      const padLights = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const m = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#ff9a3c", emissiveIntensity: 3 });
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), m);
        l.position.set(Math.cos(a) * 1.42, 0.08, Math.sin(a) * 1.42);
        pad.add(l);
        padLights.push(m);
      }
      scene.add(pad);

      // Rocks strewn around the pad, so the ground has scale up close.
      const pebbleMat = new THREE.MeshStandardMaterial({ color: "#8a5a40", roughness: 0.95, metalness: 0, flatShading: true });
      const pebbles = new THREE.InstancedMesh(rockGeometry(31), pebbleMat, 200);
      {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        for (let i = 0; i < pebbles.count; i++) {
          const a = rand(0, Math.PI * 2);
          const d = 2.2 + Math.random() ** 1.4 * 45;
          const size = (0.025 + Math.random() ** 4 * 0.14) * (1 + d / 25);
          const pos = PAD.clone().add(v3(Math.cos(a) * d, 0, Math.sin(a) * d));
          pos.normalize().multiplyScalar(RP + size * 0.05);
          q.setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
          m.compose(pos, q, v3(size, size * 0.6, size * 1.1));
          pebbles.setMatrixAt(i, m);
        }
      }
      scene.add(pebbles);

      // Vulcan breaking up around the pad: a glowing crack across the ground, eruptions on the
      // horizon, and the last other ships climbing away beyond it.
      const crackFrom = PAD.clone().add(v3(-9, 0, 7));
      const crackWay = v3(0.62, 0, -1).normalize();
      const crackLine = fissure(11, crackFrom, crackWay, 70, 0.26);
      const crackCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 1.2, 0.3), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const crackGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.16, 0.035), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(crackLine.geo, crackCore), new THREE.Mesh(fissure(11, crackFrom, crackWay, 70, 2.6).geo, crackGlow));
      const towardHorizon = v3(0.61, 0, -0.79);
      const vents = [
        [-0.42, 62],
        [0.33, 84],
      ].map(([a, d]) => {
        const pos = PAD.clone().addScaledVector(towardHorizon.clone().applyAxisAngle(UP, a), d).normalize().multiplyScalar(RP);
        const glow = glowSprite("#ff6a1e", 1);
        glow.position.copy(pos).addScaledVector(pos.clone().normalize(), 2);
        scene.add(glow);
        return { pos, up: pos.clone().normalize(), glow };
      });
      const ash = new ParticleSystem(400, { soft: 1.1 });
      const lava = new ParticleSystem(300, { additive: true, soft: 2 });
      scene.add(ash.points, lava.points);
      const fleeing = [
        [-0.3, 170, 0.0],
        [0.42, 230, 0.9],
        [0.12, 300, 2.0],
      ].map(([a, d, at]) => {
        const base = PAD.clone().addScaledVector(towardHorizon.clone().applyAxisAngle(UP, a), d).normalize().multiplyScalar(RP);
        const glow = glowSprite("#d6ecff", 1);
        glow.visible = false;
        scene.add(glow);
        return { base, up: base.clone().normalize(), at, glow };
      });

      // Ships.
      const ship = buildStarship();
      const shipUp = SHIP_POS.clone().normalize();
      const shipFwd = EAST.clone().addScaledVector(shipUp, -EAST.dot(shipUp)).normalize();
      const shipSide = shipFwd.clone().cross(shipUp);
      ship.group.position.copy(SHIP_POS);
      ship.group.quaternion.copy(facing(shipFwd, shipUp));
      scene.add(ship.group);
      ship.group.updateMatrixWorld(true);
      const shipAtRest = ship.group.matrixWorld.clone();
      const bayStop = ship.bay.clone().applyMatrix4(shipAtRest);
      // Where the ship runs to before Vulcan goes: far enough to see the whole planet, half in daylight.
      const escapeDir = shipFwd.clone().multiplyScalar(Math.cos(0.66)).addScaledVector(shipSide, -Math.sin(0.66));
      const escape = new THREE.CubicBezierCurve3(
        SHIP_POS.clone(),
        SHIP_POS.clone().addScaledVector(shipFwd, 400),
        escapeDir.clone().multiplyScalar(5000),
        escapeDir.clone().multiplyScalar(7000),
      );
      function placeShip(T) {
        const k = easeInOut((T - JUMP) / (ARRIVE - JUMP));
        escape.getPoint(k, ship.group.position);
        const fwd = escape.getTangent(k);
        // Bank into the turn, level out on arrival.
        const up = shipUp.clone().applyAxisAngle(fwd, -0.35 * Math.sin(Math.PI * k));
        ship.group.quaternion.copy(facing(fwd, up));
        // The jump to warp: away along the route, faster and faster.
        if (T > WARP) ship.group.position.addScaledVector(fwd, 16 * (Math.exp((T - WARP) * 4.5) - 1));
        ship.group.updateMatrixWorld(true);
      }
      // Where the ship rests once clear, which the last act is framed on, and the stars it finds ahead.
      const restPos = escape.getPoint(1);
      const shipRest = new THREE.Matrix4().compose(restPos, facing(escape.getTangent(1), shipUp), v3(1, 1, 1));
      const hudWorld = HUD_STARS.map((s) => {
        const at = v3(...s.at).applyMatrix4(shipRest);
        const glow = glowSprite(s.color, at.distanceTo(restPos) * 0.016);
        glow.position.copy(at);
        scene.add(glow);
        return at;
      });
      const warpFlash = glowSprite("#cfe8ff", 1);
      warpFlash.visible = false;
      scene.add(warpFlash);

      const shuttle = buildShuttle();
      scene.add(shuttle.group);
      const thrusterGlow = shuttle.under.map(() => glowSprite("#9fd8ff", 0.5));
      const engineGlow = shuttle.aft.map((_, i) => glowSprite(i ? "#8fd0ff" : "#ff9a5a", 0.4));
      for (const g of [...thrusterGlow, ...engineGlow]) shuttle.group.add(g);
      shuttle.under.forEach((p, i) => thrusterGlow[i].position.copy(p));
      shuttle.aft.forEach((p, i) => engineGlow[i].position.copy(p));
      const liftLight = new THREE.PointLight("#9fd8ff", 0, 6, 2);
      liftLight.position.set(0, -0.3, 0);
      shuttle.group.add(liftLight);

      // Dust and vapour (soft, normal blend).
      const dust = new ParticleSystem(900);
      scene.add(dust.points);

      // Shuttle path: hover off the pad, then one curve up to a line behind the ship and
      // straight along it into the hangar. Speeds match where the pieces meet, so it never jerks.
      const p0 = PAD.clone().addScaledVector(UP, 0.22);
      const climbTop = p0.clone().addScaledVector(UP, 6);
      const LINE = 32;
      const lineUp = bayStop.clone().addScaledVector(shipFwd, -LINE);
      const flight = new THREE.CurvePath();
      flight.add(new THREE.CubicBezierCurve3(climbTop, climbTop.clone().addScaledVector(UP, 160), lineUp.clone().addScaledVector(shipFwd, -140), lineUp));
      flight.add(new THREE.LineCurve3(lineUp, bayStop));
      const flightLen = flight.getLength();
      const lineSpeed = 20;
      function flightAt(T) {
        const d = T < ALIGN
          ? hermite(0, flightLen - LINE, 0, lineSpeed, (T - CLIMB) / (ALIGN - CLIMB), ALIGN - CLIMB)
          : hermite(flightLen - LINE, flightLen, lineSpeed, 0, (T - ALIGN) / (DOCK - ALIGN), DOCK - ALIGN);
        return d / flightLen;
      }
      function shuttlePose(T) {
        if (T < CLIMB) {
          const h = T < LIFT ? 0 : 6 * easeInOut((T - LIFT) / (CLIMB - LIFT));
          return { pos: p0.clone().addScaledVector(UP, h), dir: UP.clone(), quat: facing(EAST, UP), thrust: T < LIFT - 0.5 ? 0 : 1, vtol: 1 };
        }
        const u = flightAt(T);
        const pos = flight.getPoint(u);
        const dir = flight.getTangent(u);
        const up = pos.clone().normalize();
        // The nose pitches up off the pad but never quite vertical, then follows the path in.
        const tilt = smooth(CLIMB, CLIMB + 1.0, T);
        const fwd = EAST.clone().addScaledVector(up, -EAST.dot(up)).lerp(dir, tilt * (0.85 + 0.15 * smooth(ALIGN - 1, ALIGN, T))).normalize();
        return { pos, dir, quat: facing(fwd, up), thrust: 1 - smooth(ALIGN - 0.5, DOCK - 0.4, T), vtol: 1 - tilt };
      }

      // Blast: flash, flat shock ring, light for the debris, rocks, embers, smoke.
      const flash = glowSprite("#fff0d8", 1);
      const remnant = glowSprite("#ff8a3a", 1);
      flash.visible = false;
      remnant.visible = false;
      scene.add(flash, remnant);
      const ringMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uFade: { value: 0 } },
        vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}`,
        fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float uFade;\nvarying vec2 vUv;\nvoid main(){\n#include <logdepthbuf_fragment>\n float r = vUv.x; float edge = smoothstep(0.84, 0.975, r) * (1.0 - smoothstep(0.975, 1.0, r)) + 0.06 * smoothstep(0.2, 0.95, r);\n vec3 c = mix(vec3(1.8,0.8,0.3), vec3(1.6,2.0,2.4), smoothstep(0.85, 0.98, r));\n gl_FragColor = vec4(c * edge * uFade, 1.0);\n}`,
      });
      const ringGeo = new THREE.RingGeometry(0.0, 1, 256, 8);
      // RingGeometry UVs are planar; remap u to the radius for the shader.
      const ruv = ringGeo.attributes.uv;
      const rp = ringGeo.attributes.position;
      for (let i = 0; i < ruv.count; i++) ruv.setXY(i, Math.hypot(rp.getX(i), rp.getY(i)), 0);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.visible = false;
      const ringNormal = UP.clone().addScaledVector(escapeDir, -UP.dot(escapeDir)).normalize().multiplyScalar(0.98).addScaledVector(escapeDir, 0.2).normalize();
      ring.quaternion.setFromUnitVectors(v3(0, 0, 1), ringNormal);
      scene.add(ring);
      const coreLight = new THREE.PointLight("#ff8a3a", 0, 0, 2);
      scene.add(coreLight);
      const rockMat = new THREE.MeshStandardMaterial({ color: "#4a3428", roughness: 0.95, metalness: 0, emissive: "#ff5a1a", emissiveIntensity: 0, flatShading: true });
      const rocks = new THREE.InstancedMesh(rockGeometry(7), rockMat, 46);
      rocks.visible = false;
      rocks.frustumCulled = false;
      scene.add(rocks);
      const rockState = [];
      const embers = new ParticleSystem(600, { additive: true, soft: 2.2 });
      const smoke = new ParticleSystem(120);
      scene.add(embers.points, smoke.points);

      let W = 0;
      let H = 0;
      const { composer, bloom, film } = createComposer(renderer, scene, camera);
      function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        renderer.setSize(W, H, false);
        composer.setPixelRatio(pixelRatio);
        composer.setSize(W, H);
        bloom.setSize(Math.round((W * pixelRatio) / 2), Math.round((H * pixelRatio) / 2));
        camera.aspect = W / H;
        // Tall (phone) screens see less sideways, so widen the view to keep the ship in frame.
        camera.fov = 50 * (W < H ? 1 + (1 - W / H) * 0.9 : 1);
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener("resize", resize);

      // The camera, start to finish. Up to docking it is tied to the shuttle by an offset in
      // (east, up, side) terms: level with it after the lift, above it for the climb so Vulcan
      // curves away below, in behind it for the approach, then easing back to watch it go in.
      const padLook = PAD.clone().add(v3(0.6, 1.0, -1.2));
      const riseEnd = PAD.clone().add(v3(-8.5 + 0.4 * CLIMB + 2, 7, 10.5 - 0.4 * CLIMB - 1));
      const chaseFrom = riseEnd.clone().sub(climbTop);
      const chaseHigh = v3(-4.5, 4.2, 3.2);
      const chaseBehind = v3(-6.0, 1.0, 1.6);
      const chaseHold = v3(-12, 2.2, 3.4);
      function chaseCamera(T, pose, outPos, outLook) {
        if (T < CLIMB) {
          // A low aerial shot of the pad at sunrise, drifting in, then rising with the lift-off.
          const a = easeInOut((T - LIFT) / (CLIMB - LIFT));
          outPos.copy(PAD).add(v3(-8.5 + 0.4 * T + 2 * a, 3 + 4 * a, 10.5 - 0.4 * T - a));
          outLook.copy(padLook).lerp(pose.pos, smooth(LIFT, LIFT + 1.2, T));
          return;
        }
        const toBay = smooth(ALIGN - 1.8, ALIGN + 0.2, T);
        const o = chaseFrom.clone().lerp(chaseHigh, smooth(CLIMB, CLIMB + 1.6, T)).lerp(chaseBehind, toBay).lerp(chaseHold, smooth(ALIGN, DOCK, T));
        const up = pose.pos.clone().normalize();
        const east = EAST.clone().addScaledVector(up, -EAST.dot(up)).normalize();
        const side = east.clone().cross(up);
        outPos.copy(pose.pos).addScaledVector(east, o.x).addScaledVector(up, o.y).addScaledVector(side, o.z);
        // Aim a little below the shuttle so it sits high in frame, clear of the captions.
        outLook.copy(pose.pos).addScaledVector(up, -1.5 * smooth(CLIMB, CLIMB + 1.6, T)).lerp(bayStop, toBay);
      }
      // After docking the camera rides with the ship, in its own frame: from behind the hangar,
      // up over the starboard side and round off the bow, looking back past the ship at Vulcan.
      const holdPos = v3();
      const holdLook = v3();
      chaseCamera(DOCK, shuttlePose(DOCK), holdPos, holdLook);
      const toShipFrame = shipAtRest.clone().invert();
      const sweep = new THREE.CubicBezierCurve3(holdPos.clone().applyMatrix4(toShipFrame), v3(-14, 9, 10), v3(18, 14, 16), v3(55, 8, 10));
      const holdLookLocal = holdLook.clone().applyMatrix4(toShipFrame);
      const shipMid = v3(2, 0.5, 0);
      function sweepCamera(T, outPos, outLook) {
        const k = easeInOut((T - JUMP) / (ARRIVE - JUMP));
        // A slow push in while Vulcan goes.
        sweep.getPoint(k, outPos).x -= 6 * smooth(ARRIVE - 0.4, TURN, T);
        outPos.applyMatrix4(ship.group.matrixWorld);
        const toShip = holdLookLocal.clone().lerp(shipMid, smooth(JUMP, JUMP + 1.2, T)).applyMatrix4(ship.group.matrixWorld).sub(outPos).normalize();
        const toPlanet = outPos.clone().negate().normalize();
        outLook.copy(outPos).add(toShip.lerp(toPlanet, 0.6 * smooth(JUMP + 1.5, ARRIVE, T)));
      }

      // A quake throws dust up off the ground all round the pad.
      function quakeDust() {
        for (let i = 0; i < 40; i++) {
          const a = rand(0, Math.PI * 2);
          const d = rand(1.6, 14);
          const at = PAD.clone().add(v3(Math.cos(a) * d, 0, Math.sin(a) * d)).normalize().multiplyScalar(RP + 0.05);
          dust.add({
            pos: at, vel: at.clone().normalize().multiplyScalar(rand(0.3, 1.2)),
            size: rand(0.4, 1.0), grow: rand(0.6, 1.4), life: rand(1.5, 2.6), drag: 0.6, alpha: 0.18,
            color: [0.8, 0.55, 0.42], end: [0.55, 0.4, 0.32],
          });
        }
      }

      // Sounds and moments, each fired once as the film passes it.
      const cues = [
        ...QUAKES.map((q) => [q, () => (sfx("quake"), quakeDust())]),
        [BOOM, () => sfx("blast")],
        [ALARM, () => sfx("alert")],
        [SCAN, () => sfx("scan")],
        [WARP - 0.85, () => sfx("warpCharge")],
        [WARP, () => sfx("warpJump")],
      ];
      let cue = 0;
      // Then round behind the ship to look ahead past it, at the stars the scan will find.
      const turnPath = new THREE.CubicBezierCurve3(v3(49, 8, 10), v3(52, 16, 46), v3(-40, 22, 40), v3(-70, 16, -14));
      const restMid = shipMid.clone().applyMatrix4(shipRest);
      function turnCamera(T, outPos, outLook) {
        // Off to one side so the ship sits right of the captions; nearer the middle on tall screens.
        const side = W < H ? -6 : -14;
        turnPath.v3.z = side;
        const k = easeInOut((T - TURN) / (AHEAD - TURN));
        sweepCamera(TURN, outPos, outLook);
        const from = outLook.clone().sub(outPos).normalize();
        turnPath.getPoint(k, outPos).applyMatrix4(shipRest);
        const toShip = restMid.clone().sub(outPos).normalize();
        const toAhead = v3(420, -20, side).applyMatrix4(shipRest).sub(outPos).normalize();
        outLook.copy(outPos).add(from.lerp(toShip, smooth(0, 0.45, k)).lerp(toAhead, smooth(0.4, 1, k)).normalize());
      }

      // The scan, drawn over the film in screen pixels like the star map: a ring sweeping out from
      // the ship, each star lighting up as it passes, lanes between them, then the route home.
      const hud = hudRef.current;
      const hudSweep = hud.querySelector(".hud-sweep");
      const hudLanes = [...hud.querySelectorAll(".hud-lane")];
      const hudRoute = [...hud.querySelectorAll(".hud-route")];
      const hudMarks = [...hud.querySelectorAll(".hud-mark")];
      const onScreen = v3();
      function screenAt(p) {
        onScreen.copy(p).project(camera);
        return [(onScreen.x + 1) * 0.5 * W, (1 - onScreen.y) * 0.5 * H];
      }
      function drawHud(T) {
        const show = smooth(SCAN - 0.1, SCAN + 0.2, T) * (1 - smooth(WARP, WARP + 0.4, T));
        hud.style.opacity = show;
        if (show <= 0) return;
        const diag = Math.hypot(W, H);
        const ship2d = screenAt(restMid);
        const stars2d = hudWorld.map(screenAt);
        const at = (i) => (i < 0 ? ship2d : stars2d[i]);
        const seen = stars2d.map(([x, y]) => SCAN + 1.4 * (1 - Math.cbrt(1 - Math.min(1, Math.hypot(x - ship2d[0], y - ship2d[1]) / diag))));
        const when = (i) => (i < 0 ? SCAN : seen[i]);
        const ring = clamp((T - SCAN) / 1.4);
        hudSweep.setAttribute("cx", ship2d[0]);
        hudSweep.setAttribute("cy", ship2d[1]);
        hudSweep.setAttribute("r", easeOut(ring) * diag);
        hudSweep.style.opacity = (1 - ring) * 0.9;
        hudMarks.forEach((m, i) => {
          const k = smooth(seen[i], seen[i] + 0.3, T);
          m.setAttribute("transform", `translate(${stars2d[i][0].toFixed(1)} ${stars2d[i][1].toFixed(1)}) scale(${(0.6 + 0.4 * k).toFixed(3)})`);
          m.style.opacity = k;
        });
        const draw = (el, [a, b], k) => {
          const [x1, y1] = at(a);
          const [x2, y2] = at(b);
          el.setAttribute("x1", x1);
          el.setAttribute("y1", y1);
          el.setAttribute("x2", x1 + (x2 - x1) * k);
          el.setAttribute("y2", y1 + (y2 - y1) * k);
          el.style.opacity = k > 0 ? 1 : 0;
        };
        HUD_LANES.forEach((lane, i) => {
          const from = Math.max(when(lane[0]), when(lane[1]));
          draw(hudLanes[i], lane, smooth(from, from + 0.5, T));
        });
        HUD_ROUTE.forEach((leg, i) => draw(hudRoute[i], leg, smooth(ROUTE + i * 0.7, ROUTE + i * 0.7 + 0.7, T)));
      }

      let alarmShown = false;
      let boomed = false;
      let lastRcs = 0;
      let shown = -1;
      let slowSum = 0;
      let slowN = 0;
      const start = performance.now();
      let last = start;
      let raf = 0;
      const camPos = v3();
      const camLook = v3();

      function frame(now) {
        const T = (now - start) / 1000;
        const rawDt = (now - last) / 1000;
        const dt = Math.min(0.05, rawDt);
        last = now;
        if (rawDt < 0.25) {
          slowSum += rawDt;
          slowN += 1;
          if (slowN === 45) {
            if (slowSum / slowN > 0.024 && pixelRatio > 0.6) {
              pixelRatio = Math.max(0.6, pixelRatio * 0.75);
              renderer.setPixelRatio(pixelRatio);
              resize();
            }
            slowSum = 0;
            slowN = 0;
          }
        }
        if (T >= END) {
          finish();
          return;
        }
        while (cue < cues.length && T >= cues[cue][0]) cues[cue++][1]();
        const cap = captionAt(T);
        if (cap !== shown) {
          shown = cap;
          setCaption(cap);
        }

        // --- Shuttle -------------------------------------------------------------
        const pose = shuttlePose(T);
        shuttle.group.position.copy(pose.pos);
        shuttle.group.quaternion.copy(pose.quat);
        // Hidden once the hangar doors shut behind it, so the ship can leave with it.
        shuttle.group.visible = T < JUMP;
        animateShuttle(shuttle, pose.thrust, T);
        const flick = 0.85 + 0.15 * Math.sin(T * 63) + 0.08 * Math.sin(T * 141);
        thrusterGlow.forEach((g) => g.scale.setScalar(0.28 * pose.thrust * pose.vtol * flick));
        engineGlow.forEach((g, i) => g.scale.setScalar((i ? 0.28 : 0.45) * pose.thrust * (1 - pose.vtol * 0.7) * flick));
        liftLight.intensity = 2.5 * pose.thrust * pose.vtol * (1 - smooth(CLIMB - 0.6, CLIMB, T));
        padLights.forEach((m, i) => (m.emissiveIntensity = Math.sin(T * 4 - i * 0.7) > 0.2 ? 4 : 0.3));

        const altitude = pose.pos.length() - RP;
        // Dust off the pad while the thrusters are close to the ground.
        if (pose.thrust > 0 && altitude < 4 && T < CLIMB) {
          const ground = 1 - clamp(altitude / 4);
          for (let i = 0; i < 4; i++) {
            const a = rand(0, Math.PI * 2);
            const out = v3(Math.cos(a), 0, Math.sin(a));
            dust.add({
              pos: PAD.clone().addScaledVector(out, rand(0.2, 0.8)).addScaledVector(UP, 0.05),
              vel: out.multiplyScalar(rand(1.5, 5) * ground).addScaledVector(UP, rand(0.1, 0.6)),
              size: rand(0.3, 0.7), grow: rand(0.8, 1.8), life: rand(1.6, 2.8), drag: 0.9, alpha: 0.2 * ground,
              color: [0.82, 0.55, 0.4], end: [0.55, 0.38, 0.3],
            });
          }
        }
        // Thin vapour trail while still in the air.
        if (T > CLIMB && altitude < 120) {
          const back = v3(-1, 0, 0).applyQuaternion(pose.quat);
          for (let i = 0; i < 2; i++) {
            dust.add({
              pos: pose.pos.clone().addScaledVector(back, 0.7), vel: back.clone().multiplyScalar(rand(0.2, 0.8)),
              size: 0.25 + altitude * 0.01, grow: 0.6 + altitude * 0.02, life: rand(1.4, 2.2), drag: 0.4,
              alpha: 0.35 * (1 - altitude / 120), color: [0.92, 0.88, 0.86], end: [0.7, 0.66, 0.66],
            });
          }
        }
        // Braking puffs from the nose while it lines up on the hangar.
        if (T > ALIGN + 0.3 && T < DOCK - 0.8 && T - lastRcs > 0.12) {
          lastRcs = T;
          const fwd = v3(1, 0, 0).applyQuaternion(pose.quat);
          const side = v3(0, 0, 1).applyQuaternion(pose.quat);
          for (const s of [-1, 1]) {
            dust.add({
              pos: pose.pos.clone().addScaledVector(fwd, 0.5).addScaledVector(side, s * 0.25), vel: fwd.clone().multiplyScalar(2).addScaledVector(side, s * 0.6),
              size: 0.08, grow: 0.5, life: 0.55, alpha: 0.6, color: [0.95, 0.97, 1], end: [0.8, 0.85, 0.9],
            });
          }
        }
        // The crack by the pad pulses and steams; ash and embers drift down past the camera.
        const pulse = 0.8 + 0.12 * Math.sin(T * 5.3) + 0.08 * Math.sin(T * 13.1);
        crackCore.color.setRGB(3.4 * pulse, 1.2 * pulse, 0.3 * pulse);
        if (T < CLIMB + 2 && Math.random() < dt * 14) {
          const at = crackLine.line[Math.floor(rand(4, crackLine.line.length - 4))];
          const up = at.clone().normalize();
          dust.add({
            pos: at.clone().addScaledVector(up, 0.1), vel: up.multiplyScalar(rand(0.4, 1.1)).add(v3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2))),
            size: rand(0.3, 0.6), grow: rand(0.8, 1.6), life: rand(1.8, 3), drag: 0.3, alpha: 0.16, color: [0.95, 0.72, 0.55], end: [0.6, 0.55, 0.52],
          });
        }
        if (T < CLIMB + 1.2 && Math.random() < dt * 30) {
          const ahead = camera.getWorldDirection(v3());
          const right = ahead.clone().cross(camera.up).normalize();
          embers.add({
            pos: camera.position.clone().addScaledVector(ahead, rand(2.5, 9)).addScaledVector(right, rand(-5, 5)).addScaledVector(camera.up, rand(-0.5, 3.5)),
            vel: v3(rand(0.2, 0.7), -rand(0.15, 0.45), rand(-0.3, 0.3)), size: rand(0.02, 0.045), life: rand(2, 3.2),
            alpha: 1, color: [2.6, 1.0, 0.28], end: [0.5, 0.1, 0.03],
          });
        }
        // Eruptions on the horizon, throwing up lava and columns of ash that lean in the wind.
        for (const v of vents) {
          v.glow.visible = T < ALIGN;
          if (T >= ALIGN) continue;
          v.glow.scale.setScalar(11 * (0.85 + 0.15 * Math.sin(T * 9 + v.pos.x)));
          if (Math.random() < dt * 22) {
            ash.add({
              pos: v.pos.clone().addScaledVector(v.up, 1.5), vel: v.up.clone().multiplyScalar(rand(7, 11)).addScaledVector(EAST, rand(1.5, 3)).add(v3(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))),
              size: rand(3, 5), grow: rand(2.5, 4), life: rand(6, 8), drag: 0.3, alpha: 1, color: [0.24, 0.13, 0.08], end: [0.07, 0.06, 0.06],
            });
          }
          for (let i = 0; i < 2; i++) {
            if (Math.random() < dt * 16) {
              lava.add({
                pos: v.pos.clone().addScaledVector(v.up, 0.5), vel: v.up.clone().multiplyScalar(rand(4, 10)).add(v3(rand(-3, 3), 0, rand(-3, 3))),
                size: rand(0.6, 1.5), life: rand(0.7, 1.4), drag: 0.7, alpha: 1, color: [3.2, 1.3, 0.3], end: [1.2, 0.2, 0.03],
              });
            }
          }
        }
        // The last other ships rising from beyond the horizon, trailing vapour.
        for (const f of fleeing) {
          const t = T - f.at;
          f.glow.visible = t > 0 && T < DOCK;
          if (!f.glow.visible) continue;
          const h = 5 * t + 6 * t * t;
          f.glow.position.copy(f.base).addScaledVector(f.up, h).addScaledVector(EAST, 0.3 * h);
          f.glow.scale.setScalar(2.6 * (0.85 + 0.15 * Math.sin(T * 40 + f.at * 7)));
          if (Math.random() < dt * 30) {
            dust.add({ pos: f.glow.position, vel: v3(), size: 0.6, grow: 1.4, life: rand(1.6, 2.4), alpha: 0.12, color: [0.95, 0.93, 0.92], end: [0.75, 0.72, 0.72] });
          }
        }
        dust.update(dt);
        ash.update(dt);
        lava.update(dt);

        // --- Starship: hangar doors open for the shuttle, then it powers up and runs ---
        if (T >= JUMP) placeShip(T);
        const doors = smooth(ALIGN - 1.6, ALIGN - 0.4, T) * (1 - smooth(DOCK + 0.05, JUMP - 0.05, T));
        const power = smooth(DOCK + 0.2, JUMP + 0.4, T);
        animateStarship(ship, power, T, doors);
        // The hum sinks as Vulcan breaks up, idles low on the damaged ship, then roars for the jump.
        const off = 1 - smooth(END - 0.6, END, T);
        engine(Math.max(power * (1 - 0.65 * smooth(BOOM, HIT + 0.5, T)), smooth(WARP - 0.85, WARP, T)) * off);

        // --- The last act: the ship vents air, the alarm sounds, then it jumps to warp ----------
        if (T > HIT && T < WARP + 0.3) {
          const at = v3(...VENT).applyMatrix4(ship.group.matrixWorld);
          const out = v3(...VENT_OUT).normalize().applyQuaternion(ship.group.quaternion);
          for (let i = 0; i < 2; i++) {
            dust.add({
              pos: at, vel: out.clone().multiplyScalar(rand(2.5, 5)).add(v3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))),
              size: 0.25, grow: rand(0.8, 1.6), life: rand(1.2, 2.0), drag: 0.6, alpha: 0.3, color: [0.86, 0.9, 0.96], end: [0.6, 0.64, 0.7],
            });
          }
          if (Math.random() < dt * 5) {
            for (let i = 0; i < 6; i++) {
              embers.add({
                pos: at, vel: out.clone().multiplyScalar(rand(4, 9)).add(v3(rand(-2, 2), rand(-2, 2), rand(-2, 2))),
                size: rand(0.05, 0.1), life: rand(0.3, 0.6), drag: 1.2, alpha: 1, color: [3, 2.2, 1.2], end: [2, 0.5, 0.1],
              });
            }
          }
        }
        const alarmOn = T >= ALARM && T < WARP;
        if (alarmOn !== alarmShown) {
          alarmShown = alarmOn;
          setAlarm(alarmOn);
        }
        warpFlash.visible = T > WARP;
        if (warpFlash.visible) {
          const w = T - WARP;
          warpFlash.position.copy(ship.group.position);
          warpFlash.scale.setScalar(60 * Math.min(1, w * 6) * Math.exp(-w * 2.5) + 1);
          warpFlash.material.opacity = Math.exp(-w * 2);
        }

        // --- Vulcan breaks up ------------------------------------------------------
        const since = T - BOOM;
        // Cracks glow across Vulcan from the start and spread as the shuttle climbs, then split it open.
        const crack = Math.max(0.14 + 0.3 * smooth(LIFT, DOCK, T), smooth(ARRIVE - 0.8, BOOM, T));
        planetMat.uniforms.crack.value = crack;
        planetMat.uniforms.city.value = 1 - crack;
        const flashV = since >= 0 ? Math.exp(-since * 3) * (reduce ? 0.4 : 1) : 0;
        const boom = since >= 0 ? easeOut(since / 2.8) : 0;
        planetMat.uniforms.boom.value = boom;
        atmosphere.visible = boom < 0.3;
        atmMat.uniforms.strength.value = Math.max(0, 1 - boom * 3);
        if (since >= 0 && !boomed) {
          boomed = true;
          flash.visible = true;
          remnant.visible = true;
          ring.visible = true;
          rocks.visible = true;
          for (let i = 0; i < rocks.count; i++) {
            const d = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            rockState.push({
              pos: d.clone().multiplyScalar(RP * Math.sqrt(Math.random()) * 0.8),
              vel: d.clone().multiplyScalar(RP * rand(0.25, 1.5)),
              axis: v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
              spin: rand(-1.4, 1.4),
              size: RP * rand(0.04, 0.14),
            });
          }
          for (let i = 0; i < 560; i++) {
            const d = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            embers.add({
              pos: d.clone().multiplyScalar(RP * Math.sqrt(Math.random()) * 0.9), vel: d.multiplyScalar(RP * (0.6 + 6 * Math.random() ** 2)),
              size: RP * rand(0.01, 0.03), life: rand(1.2, 3.6), drag: 0.55, alpha: 1, color: [3, 2.2, 1.4], end: [2.2, 0.6, 0.15],
            });
          }
          for (let i = 0; i < 60; i++) {
            const d = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
            smoke.add({
              pos: d.clone().multiplyScalar(RP * Math.random() * 0.6), vel: d.multiplyScalar(RP * rand(0.2, 0.8)),
              size: RP * rand(0.5, 0.9), grow: RP * 0.5, life: rand(2.5, 4), drag: 0.4, alpha: 0.32, color: [0.55, 0.26, 0.14], end: [0.3, 0.14, 0.1],
            });
          }
        }
        if (boomed) {
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          rockState.forEach((r, i) => {
            r.vel.multiplyScalar(Math.exp(-0.25 * dt));
            r.pos.addScaledVector(r.vel, dt);
            q.setFromAxisAngle(r.axis, r.spin * since);
            m.compose(r.pos, q, v3(r.size, r.size * 0.8, r.size));
            rocks.setMatrixAt(i, m);
          });
          rocks.instanceMatrix.needsUpdate = true;
          rockMat.emissiveIntensity = 0.45 * Math.exp(-since * 0.9);
          const grow = 1 - Math.pow(1 - clamp(since / 2.8), 4);
          ring.scale.setScalar(RP * (1 + grow * 6));
          ringMat.uniforms.uFade.value = (1 - clamp(since / 3)) * 0.9;
          flash.scale.setScalar(RP * (1.5 + since * 1.2) * Math.max(0.05, flashV));
          flash.material.opacity = Math.min(1, flashV * 0.85);
          const rem = Math.exp(-since * 0.9);
          remnant.scale.setScalar(RP * (1.6 + since * 0.9));
          remnant.material.opacity = rem * 0.8;
          coreLight.intensity = 4e7 * (flashV * 0.5 + rem * 0.6);
        }
        embers.update(dt);
        smoke.update(dt);

        // --- Camera ----------------------------------------------------------------
        if (T < JUMP) chaseCamera(T, pose, camPos, camLook);
        else if (T < TURN) sweepCamera(T, camPos, camLook);
        else turnCamera(T, camPos, camLook);
        camera.position.copy(camPos);
        camera.up.copy(camPos.clone().normalize().lerp(shipUp, smooth(ALIGN - 1.8, ALIGN, T)).normalize());
        camera.lookAt(camLook);
        // A tremor as the crust splits, a jolt at the blast, another as the shock ring rolls past.
        const tremor = since < 0 ? 0.003 * crack : 0;
        const jolt = since >= 0 ? 0.025 * Math.exp(-since * 2.2) + (since > 2.2 ? 0.02 * Math.exp(-(since - 2.2) * 3) : 0) : 0;
        const quake = T < CLIMB ? QUAKES.reduce((sum, q) => sum + (T > q ? 0.012 * Math.exp(-(T - q) * 3) : 0), 0) : 0;
        const shake = reduce ? 0 : tremor + jolt + quake;
        camera.rotateX(shake * (Math.sin(T * 83) + Math.sin(T * 47)));
        camera.rotateY(shake * (Math.sin(T * 71) + Math.cos(T * 53)));
        camera.rotateZ(shake * 0.5 * Math.sin(T * 39));
        camera.updateMatrixWorld();
        drawHud(T);

        // Atmosphere and ground detail by altitude.
        const camAlt = camPos.length() - RP;
        planetMat.uniforms.hazeAmount.value = 1 - smooth(20, 260, camAlt);
        planetMat.uniforms.hazeDist.value = 160;
        planetMat.uniforms.detail.value = 1 - smooth(80, 700, camAlt);
        skyMat.color.setScalar(0.05 + 0.95 * smooth(15, 220, camAlt));
        starMat.opacity = smooth(8, 220, camAlt);
        // Warm light bouncing off the desert while low, fading in orbit.
        bounce.intensity = 0.5 + 1.2 * (1 - smooth(10, 300, camAlt));

        // Sun, sky and stars stay infinitely far: follow the camera.
        sky.position.copy(camPos);
        stars.position.copy(camPos);
        sunCore.position.copy(camPos).addScaledVector(SUN, 30000);
        sunHalo.position.copy(sunCore.position);
        sunCore.scale.setScalar(900);
        sunHalo.scale.setScalar(5200);
        sunHalo.material.opacity = 0.45;

        for (const ps of [dust, embers, smoke, ash, lava]) ps.setScale(camera, H * pixelRatio);
        film.uniforms.uTime.value = T;
        film.uniforms.uBlack.value = 1 - smooth(0, 1, T) * (1 - smooth(END - 0.8, END, T));
        film.uniforms.uWhite.value = 0.5 * Math.exp(-(((T - WARP - 0.18) / 0.16) ** 2));
        composer.render(dt);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        engine(0);
        window.removeEventListener("resize", resize);
        composer.dispose?.();
        pmrem.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          o.geometry?.dispose?.();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
        });
      };
    }

    return () => {
      cancelled = true;
      finished = true;
      window.removeEventListener("keydown", onKey);
      cleanup();
    };
  }, []);

  return (
    <main className="opener">
      <div className="intro-stage" ref={stageRef} aria-hidden="true">
        <canvas className="intro-gl" ref={canvasRef} />
      </div>
      {!ready ? <p className="intro-loading">Preparing launch…</p> : null}
      <svg className="intro-hud" ref={hudRef} aria-hidden="true">
        <circle className="hud-sweep" r="0" />
        {HUD_LANES.map((_, i) => (
          <line key={`lane${i}`} className="hud-lane" />
        ))}
        {HUD_ROUTE.map((_, i) => (
          <line key={`leg${i}`} className="hud-route" />
        ))}
        {HUD_STARS.map((s, i) => (
          <g key={i} className={s.kind ? `hud-mark ${s.kind}` : "hud-mark"}>
            <circle className="hud-ring" r="13" />
            {s.kind === "home" ? (
              <g transform="translate(15 -15)">
                <circle className="hud-beacon" r="9" />
                <text className="hud-bang" y="4.5">
                  !
                </text>
              </g>
            ) : null}
            {s.kind === "fuel" ? <path className="hud-drop" d={DROP} transform="translate(15 -15) scale(1.6)" /> : null}
            {s.label ? (
              <text className="hud-label" y="32">
                {s.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className={alarm ? "intro-alarm show" : "intro-alarm"} aria-hidden="true">
        <p className="intro-alarm-head">Life support failing</p>
        <p className="intro-alarm-clock">15:00</p>
        <p className="intro-alarm-foot">of air left</p>
      </div>
      <div className="letterbox top" aria-hidden="true" />
      <div className="letterbox bottom" aria-hidden="true" />
      <div className="opener-copy" aria-live="polite">
        {CAPTIONS.map((c, i) => (
          <div key={c.title} className={i === caption ? "cap show" : "cap"}>
            <p className="eyebrow">
              {String(i + 1).padStart(2, "0")} / {String(CAPTIONS.length).padStart(2, "0")} · Nova Grid
            </p>
            <h1>{c.title}</h1>
            <p>{c.text}</p>
          </div>
        ))}
      </div>
      <button type="button" className="skip" onClick={() => doneRef.current()}>
        Skip
      </button>
    </main>
  );
}
