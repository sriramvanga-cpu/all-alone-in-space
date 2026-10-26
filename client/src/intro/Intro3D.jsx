import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadTextures } from "../three/assets.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "../three/planetMaterial.js";
import { animateShuttle, animateStarship, buildShuttle, buildStarship } from "../three/models.js";
import { createComposer } from "../three/post.js";
import { ParticleSystem, glowSprite } from "../three/particles.js";
import { clamp, easeIn, easeInOut, easeOut, lerp, rand, smooth } from "./draw.js";

// The realistic intro: one continuous 3D camera move.
//   Launch     sunrise on Vulcan's surface; the shuttle lifts off its pad.
//   Climb      the camera chases it up until Vulcan becomes a sphere below.
//   Docking    the starship hangs in orbit; the shuttle docks at its stern.
//   Push in    the camera flies into the bridge dome until the glass fills the frame.
//   Look back  a cockpit far out; through the window Vulcan cracks and breaks apart.
const LIFT = 1.0;
const CLIMB = 3.2;
const ORBIT = 6.4;
const DOCK = 8.4;
const ZOOM0 = 9.6;
const INSIDE = 10.6;
const BOOM = INSIDE + 2.6;
const END = INSIDE + 6.4;

const CAPTIONS = [
  { from: 0.7, to: 5.0, title: "Departure", text: "A shuttle lifts off Vulcan. The ground falls away." },
  { from: 5.6, to: 9.4, title: "Docking", text: "The shuttle locks onto the ship." },
  { from: INSIDE + 0.4, to: END - 0.7, title: "Look back", text: "Through the window, Vulcan blows apart. The clock starts with the chart." },
];

const RP = 1000;
const ATM_TOP = 1055;
const UP = new THREE.Vector3(0, 1, 0);
const EAST = new THREE.Vector3(1, 0, 0);
const PAD = new THREE.Vector3(0, RP, 0);
const SUN = new THREE.Vector3(0.75, 0.3, 0.6).normalize();
const SHIP_POS = new THREE.Vector3(330, RP + 430, -20);
// Where the cockpit sits for the look back: far out, Vulcan half in daylight.
const VIEW_FROM = new THREE.Vector3(-0.55, 0.2, 0.8).normalize().multiplyScalar(7000);

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function captionAt(T) {
  return CAPTIONS.findIndex((c) => T >= c.from && T < c.to);
}

function bezier3(p0, p1, p2, p3, u, out = v3()) {
  const a = (1 - u) ** 3;
  const b = 3 * (1 - u) ** 2 * u;
  const c = 3 * (1 - u) * u * u;
  const d = u ** 3;
  return out.set(0, 0, 0).addScaledVector(p0, a).addScaledVector(p1, b).addScaledVector(p2, c).addScaledVector(p3, d);
}

function bezier2(p0, p1, p2, u, out = v3()) {
  const a = (1 - u) ** 2;
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return out.set(0, 0, 0).addScaledVector(p0, a).addScaledVector(p1, b).addScaledVector(p2, c);
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

function cockpitTexture(kind) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#04121c";
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = "rgba(90,209,255,0.25)";
  for (let x = 0; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 128);
    g.stroke();
  }
  g.strokeStyle = kind ? "#ffb060" : "#5ad1ff";
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const x = 8 + i * 6;
    const y = 64 + Math.sin(i * 0.7 + kind * 2) * 30 * Math.cos(i * 0.13);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The cockpit, built around a camera at its origin looking down -Z.
function buildCockpit(env) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#a3afc0", metalness: 0.75, roughness: 0.3 });
  const wallMat = new THREE.MeshStandardMaterial({ color: "#202834", metalness: 0.5, roughness: 0.6 });
  const outer = new THREE.Shape([v3(-5, -3), v3(5, -3), v3(5, 3.2), v3(-5, 3.2)].map((p) => new THREE.Vector2(p.x, p.y)));
  const hole = new THREE.Path();
  const w = 1.3;
  const h = 0.76;
  const r = 0.16;
  hole.moveTo(-w + r, -h);
  hole.lineTo(w - r, -h);
  hole.quadraticCurveTo(w, -h, w, -h + r);
  hole.lineTo(w, h - r);
  hole.quadraticCurveTo(w, h, w - r, h);
  hole.lineTo(-w + r, h);
  hole.quadraticCurveTo(-w, h, -w, h - r);
  hole.lineTo(-w, -h + r);
  hole.quadraticCurveTo(-w, -h, -w + r, -h);
  outer.holes.push(hole);
  const front = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outer, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 }),
    frameMat,
  );
  front.position.z = -2.1;
  group.add(front);
  for (const x of [-0.5, 0.5]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, h * 2, 0.12), frameMat);
    strut.position.set(x * 1.6, 0, -1.95);
    group.add(strut);
  }
  const room = [
    [v3(-2.6, 0.4, -0.6), [0, Math.PI / 2, 0], [3.2, 5]],
    [v3(2.6, 0.4, -0.6), [0, -Math.PI / 2, 0], [3.2, 5]],
    [v3(0, 2.4, -0.6), [Math.PI / 2, 0, 0], [5.4, 3.2]],
    [v3(0, -1.6, -0.6), [-Math.PI / 2, 0, 0], [5.4, 3.2]],
  ];
  for (const [pos, rot, [a, b]] of room) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(a, b), wallMat);
    wall.position.copy(pos);
    wall.rotation.set(...rot);
    group.add(wall);
  }
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.3, 1.1), new THREE.MeshStandardMaterial({ color: "#232b38", metalness: 0.7, roughness: 0.4 }));
  console_.position.set(0, -0.8, -1.55);
  console_.rotation.x = 0.42;
  group.add(console_);
  const screens = [];
  for (const [x, kind] of [[-1.25, 0], [0, 1], [1.25, 0]]) {
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.36),
      new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: cockpitTexture(kind), emissiveIntensity: 1.4 }),
    );
    scr.position.set(x, -0.63, -1.45);
    scr.rotation.x = -1.15;
    group.add(scr);
    screens.push(scr);
  }
  const buttons = [];
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: ["#5ad1ff", "#7ddec0", "#ffb020", "#ff7a8a"][i % 4], emissiveIntensity: 2 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.06), mat);
    b.position.set(-2.0 + (i * 4.0) / 13, -0.83, -1.12);
    b.rotation.x = 0.42;
    group.add(b);
    buttons.push({ mat, phase: Math.random() * 6, rate: 0.8 + Math.random() * 2 });
  }
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 2, h * 2),
    new THREE.MeshBasicMaterial({ color: "#c8e4ff", transparent: true, opacity: 0.03, depthWrite: false }),
  );
  glass.position.z = -1.98;
  group.add(glass);
  const fill = new THREE.PointLight("#9fd6ff", 4, 9, 2);
  fill.position.set(0, 1.9, 1.3);
  group.add(fill);
  const consoleGlow = new THREE.PointLight("#5ad1ff", 3, 4, 2);
  consoleGlow.position.set(0, -0.3, -1.1);
  group.add(consoleGlow);
  const blast = new THREE.PointLight("#ffa060", 0, 18, 1.6);
  blast.position.set(0, 0.2, -2.6);
  group.add(blast);
  return { group, buttons, blast, screens };
}

export default function Intro3D({ onDone, onFail }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const doneRef = useRef(onDone);
  const failRef = useRef(onFail);
  doneRef.current = onDone;
  failRef.current = onFail;
  const [caption, setCaption] = useState(-1);
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
      const cockpitCam = new THREE.PerspectiveCamera(55, 1, 0.05, 200000);

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

      // Ships.
      const ship = buildStarship();
      ship.group.position.copy(SHIP_POS);
      const shipUp = SHIP_POS.clone().normalize();
      const shipFwd = EAST.clone().addScaledVector(shipUp, -EAST.dot(shipUp)).normalize();
      ship.group.quaternion.copy(facing(shipFwd, shipUp));
      scene.add(ship.group);
      ship.group.updateMatrixWorld(true);
      const dockPoint = ship.dock.clone().applyMatrix4(ship.group.matrixWorld);
      const bridgePoint = ship.bridge.clone().applyMatrix4(ship.group.matrixWorld);
      const local = (x, y, z) => v3(x, y, z).applyQuaternion(ship.group.quaternion).add(SHIP_POS);

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
      const dockFlash = glowSprite("#d8f0ff", 1);
      dockFlash.position.copy(dockPoint);
      dockFlash.visible = false;
      scene.add(dockFlash);

      // Particles: dust and vapour (soft, normal blend) and hot glows (additive).
      const dust = new ParticleSystem(900);
      const glows = new ParticleSystem(500, { additive: true });
      scene.add(dust.points, glows.points);

      // Shuttle path: hover off the pad, climb, swing east into orbit, dock.
      const p0 = PAD.clone().addScaledVector(UP, 0.22);
      const climbTop = PAD.clone().addScaledVector(UP, 6.2);
      const backOff = shipFwd.clone().multiplyScalar(-70).addScaledVector(shipUp, -16);
      const orbitStart = dockPoint.clone().add(backOff);
      const ascentCtrl = v3(10, RP + 320, -5);
      const noseOffset = shuttle.nose.x;
      const tmpA = v3();
      const tmpB = v3();
      function ascentAt(a, out) {
        const k = 4.2;
        const s = (Math.exp(a * k) - 1) / (Math.exp(k) - 1);
        return bezier2(climbTop, ascentCtrl, orbitStart, s, out);
      }
      function shuttlePose(T) {
        if (T < CLIMB) {
          const h = T < LIFT ? 0 : 6 * easeInOut((T - LIFT) / (CLIMB - LIFT));
          return { pos: p0.clone().addScaledVector(UP, h), quat: facing(EAST, UP), thrust: T < LIFT - 0.5 ? 0 : 1, vtol: 1 };
        }
        if (T < ORBIT) {
          const a = (T - CLIMB) / (ORBIT - CLIMB);
          const pos = ascentAt(a, v3());
          const dir = ascentAt(Math.min(1, a + 0.01), tmpA).sub(ascentAt(Math.max(0, a - 0.01), tmpB));
          const up = pos.clone().normalize();
          const tilt = smooth(CLIMB, CLIMB + 1.0, T);
          const fwd = EAST.clone().lerp(dir.normalize(), tilt * 0.85).normalize();
          return { pos, quat: facing(fwd, up), thrust: 1, vtol: 1 - tilt };
        }
        const startDir = ascentAt(1, tmpA).sub(ascentAt(0.98, tmpB)).normalize();
        const P1 = orbitStart.clone().addScaledVector(startDir, 30);
        const P2 = dockPoint.clone().addScaledVector(shipFwd, -28);
        const k = smooth(ORBIT, DOCK, T);
        const nose = T >= DOCK ? dockPoint.clone() : bezier3(orbitStart, P1, P2, dockPoint, k);
        const ahead = T >= DOCK ? shipFwd.clone() : bezier3(orbitStart, P1, P2, dockPoint, Math.min(1, k + 0.01)).sub(bezier3(orbitStart, P1, P2, dockPoint, Math.max(0, k - 0.01))).normalize();
        const fwd = k > 0.97 ? shipFwd.clone() : ahead;
        const pos = nose.clone().addScaledVector(fwd, -noseOffset);
        return { pos, quat: facing(fwd, shipUp), thrust: T < DOCK - 0.9 ? 1 : clamp((DOCK - 0.6 - T) / 0.3), vtol: 0 };
      }

      // Look back: the cockpit far out, facing Vulcan.
      const cockpit = buildCockpit(env);
      cockpit.group.position.copy(VIEW_FROM);
      // lookAt aims a group's +Z at the target; the window is on -Z, so turn round.
      cockpit.group.lookAt(0, 0, 0);
      cockpit.group.rotateY(Math.PI);
      cockpit.group.visible = false;
      scene.add(cockpit.group);
      cockpit.group.add(cockpitCam);

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
      const viewDir = VIEW_FROM.clone().normalize();
      const ringNormal = UP.clone().addScaledVector(viewDir, -UP.dot(viewDir)).normalize().multiplyScalar(0.98).addScaledVector(viewDir, 0.2).normalize();
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
      let fovBoost = 1;
      const { composer, render, bloom, film } = createComposer(renderer, scene, camera);
      function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        renderer.setSize(W, H, false);
        composer.setPixelRatio(pixelRatio);
        composer.setSize(W, H);
        bloom.setSize(Math.round((W * pixelRatio) / 2), Math.round((H * pixelRatio) / 2));
        for (const cam of [camera, cockpitCam]) {
          cam.aspect = W / H;
          cam.updateProjectionMatrix();
        }
        // Tall (phone) screens see less sideways, so widen the view to keep the ship in frame.
        fovBoost = W < H ? 1 + (1 - W / H) * 0.9 : 1;
        cockpitCam.fov = 55 * fovBoost;
        cockpitCam.updateProjectionMatrix();
      }
      resize();
      window.addEventListener("resize", resize);

      let docked = false;
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
      const tmp = v3();

      function chaseCamera(T, pose) {
        // A low aerial shot of the pad at sunrise, drifting in, then rising with the lift-off.
        const padLook = PAD.clone().add(v3(0.6, 1.0, -1.2));
        if (T < LIFT) {
          camPos.copy(PAD).add(v3(-8.5 + T * 0.4, 3.0, 10.5 - T * 0.4));
          camLook.copy(padLook);
          return;
        }
        if (T < CLIMB) {
          const a = easeInOut((T - LIFT) / (CLIMB - LIFT));
          camPos.copy(PAD).add(v3(-8.1 + a * 2.0, 3.0 + a * 4.0, 10.1 - a * 1.0));
          camLook.copy(padLook).lerp(pose.pos, smooth(LIFT, LIFT + 1.2, T));
          return;
        }
        // Chase from behind and above, looking ahead at the horizon so the
        // planet curves away below as the shuttle climbs.
        const a = clamp((T - CLIMB) / (ORBIT - CLIMB));
        const up = pose.pos.clone().normalize();
        const ahead = EAST.clone().addScaledVector(up, -EAST.dot(up)).normalize();
        const side = ahead.clone().cross(up).normalize().negate();
        const grow = 1 + 7 * easeIn(a);
        const offset = ahead.clone().multiplyScalar(-6 * grow).addScaledVector(up, 1.6 * grow).addScaledVector(side, 3.5 * grow);
        const riseEnd = PAD.clone().add(v3(-6.1, 7.0, 9.1));
        camPos.copy(riseEnd).lerp(pose.pos.clone().add(offset), smooth(0, 0.18, a));
        // Tilt down with the horizon's dip so the planet stays in the lower frame.
        const alt = Math.max(1, pose.pos.length() - RP);
        const pitch = Math.max(0.05, Math.acos(RP / (RP + alt)) - 0.12);
        camLook.copy(camPos).addScaledVector(ahead, Math.cos(pitch) * 100).addScaledVector(up, -Math.sin(pitch) * 100);
        camLook.lerp(pose.pos, 0.35);
      }

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
        const cap = captionAt(T);
        if (cap !== shown) {
          shown = cap;
          setCaption(cap);
        }

        const inside = T >= INSIDE;
        let shake = 0;
        let activeCam = camera;

        if (!inside) {
          const pose = shuttlePose(T);
          shuttle.group.position.copy(pose.pos);
          shuttle.group.quaternion.copy(pose.quat);
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
          if (T > DOCK - 1.1 && T < DOCK - 0.1 && T - lastRcs > 0.12) {
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
          if (T >= DOCK && !docked) {
            docked = true;
            for (let i = 0; i < 40; i++) {
              const d = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
              glows.add({ pos: dockPoint, vel: d.multiplyScalar(rand(0.5, 3)), size: 0.06, life: rand(0.3, 0.8), drag: 2, alpha: 1, color: [1, 0.85, 0.6] });
            }
          }
          dust.update(dt);
          glows.update(dt);

          const contact = T >= DOCK ? Math.exp(-(T - DOCK) * 5) : 0;
          dockFlash.visible = contact > 0.01;
          dockFlash.scale.setScalar(4 * contact + 0.5);
          animateStarship(ship, smooth(DOCK + 0.2, DOCK + 1.3, T), T);

          // Camera: chase the launch, swing round to frame the ship, then dive at the bridge.
          chaseCamera(T, pose);
          const dockCam = local(-26, 30, 36);
          const dockLook = local(-3, -6, 0);
          const toDock = easeInOut(smooth(ORBIT - 0.8, ORBIT + 1.0, T));
          camPos.lerp(dockCam, toDock);
          camLook.lerp(dockLook, toDock);
          const z = clamp((T - ZOOM0) / (INSIDE - ZOOM0));
          if (z > 0) {
            const e = easeIn(z);
            camPos.lerp(bridgePoint.clone().addScaledVector(shipUp, 0.15), e);
            camLook.lerp(bridgePoint, smooth(0, 0.6, z));
          }
          camera.position.copy(camPos);
          camera.up.copy(camPos.clone().normalize());
          camera.lookAt(camLook);
          camera.fov = (50 - 10 * smooth(0.3, 1, z)) * fovBoost;
          camera.updateProjectionMatrix();

          // Atmosphere and ground detail by altitude.
          const camAlt = camPos.length() - RP;
          planetMat.uniforms.hazeAmount.value = 1 - smooth(20, 260, camAlt);
          planetMat.uniforms.hazeDist.value = 160;
          planetMat.uniforms.detail.value = 1 - smooth(80, 700, camAlt);
          skyMat.color.setScalar(0.05 + 0.95 * smooth(15, 220, camAlt));
          starMat.opacity = smooth(8, 220, camAlt);
          film.uniforms.uWhite.value = smooth(0.55, 1, z);
          sunLight.intensity = 3.0;
          // Warm light bouncing off the desert while low, fading in orbit.
          bounce.intensity = 0.5 + 1.2 * (1 - smooth(10, 300, camAlt));
        } else {
          // --- Inside the cockpit, far out, looking back at Vulcan ---------------
          activeCam = cockpitCam;
          if (!cockpit.group.visible) {
            cockpit.group.visible = true;
            ship.group.visible = false;
            shuttle.group.visible = false;
            pad.visible = false;
            pebbles.visible = false;
            dust.clear();
            glows.clear();
            dust.update(0);
            glows.update(0);
            sunLight.intensity = 0;
            bounce.intensity = 0.25;
            planetMat.uniforms.hazeAmount.value = 0;
            planetMat.uniforms.detail.value = 0;
            skyMat.color.setScalar(1);
            starMat.opacity = 1;
          }
          const t = T - INSIDE;
          const since = T - BOOM;
          const back = easeOut(t / 0.9);
          cockpitCam.position.set(0, 0, lerp(-1.75, 0, back));
          film.uniforms.uWhite.value = 1 - smooth(0, 0.6, t);
          const crack = smooth(INSIDE + 1.4, BOOM, T);
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
          cockpit.blast.intensity = 22 * Math.min(1, flashV * 1.2 + crack * 0.08 + (since > 0 ? 0.3 * Math.exp(-since * 0.8) : 0));
          cockpit.buttons.forEach((b) => (b.mat.emissiveIntensity = Math.sin(T * b.rate + b.phase) > -0.2 ? 2.4 : 0.15));
          const tremor = T > INSIDE + 1.6 && since < 0 ? 0.004 * smooth(INSIDE + 1.6, BOOM, T) : 0;
          const blastShake = since >= 0 ? 0.03 * Math.exp(-since * 2.2) : 0;
          shake = reduce ? 0 : tremor + blastShake;
          cockpitCam.rotation.set(
            shake * (Math.sin(T * 83) + Math.sin(T * 47)),
            shake * (Math.sin(T * 71) + Math.cos(T * 53)),
            shake * 0.5 * Math.sin(T * 39),
          );
        }

        // Sun, sky and stars stay infinitely far: follow the active camera.
        const eye = activeCam.getWorldPosition(tmp);
        sky.position.copy(eye);
        stars.position.copy(eye);
        sunCore.position.copy(eye).addScaledVector(SUN, 30000);
        sunHalo.position.copy(sunCore.position);
        sunCore.scale.setScalar(900);
        sunHalo.scale.setScalar(5200);
        sunHalo.material.opacity = 0.45;
        sunCore.visible = !inside;
        sunHalo.visible = !inside;

        for (const ps of [dust, glows, embers, smoke]) ps.setScale(activeCam, H * pixelRatio);
        render.camera = activeCam;
        film.uniforms.uTime.value = T;
        film.uniforms.uBlack.value = 1 - smooth(0, 1, T) * (1 - smooth(END - 0.8, END, T));
        composer.render(dt);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
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
      <div className="letterbox top" aria-hidden="true" />
      <div className="letterbox bottom" aria-hidden="true" />
      <div className="opener-copy" aria-live="polite">
        {CAPTIONS.map((c, i) => (
          <div key={c.title} className={i === caption ? "cap show" : "cap"}>
            <p className="eyebrow">
              {String(i + 1).padStart(2, "0")} / 03 · All Alone in Space
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
