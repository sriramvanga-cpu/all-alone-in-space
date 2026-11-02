import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadTextures } from "../three/assets.js";
import { makeAtmosphereMaterial, makePlanetMaterial } from "../three/planetMaterial.js";
import { animateShuttle, animateStarship, buildShuttle, buildStarship } from "../three/models.js";
import { engine } from "../sound.js";
import { createComposer } from "../three/post.js";
import { ParticleSystem, glowSprite } from "../three/particles.js";
import { clamp, easeInOut, easeOut, rand, smooth } from "./draw.js";

// The realistic intro: one unbroken camera move, no cuts.
//   Launch     sunrise on Vulcan's surface; the shuttle lifts off its pad.
//   Climb      the camera rides close behind it while Vulcan curves away below.
//   Docking    the shuttle lines up behind the starship and flies into its stern hangar.
//   Escape     the camera sweeps over the ship as it banks away into open space.
//   Look back  from off the bow, Vulcan cracks and breaks apart behind the ship.
const LIFT = 1.0;
const CLIMB = 3.2;
const ALIGN = 7.4;
const DOCK = 9.8;
const JUMP = 10.4;
const ARRIVE = 13.4;
const BOOM = ARRIVE + 1.0;
const END = BOOM + 3.6;

const CAPTIONS = [
  { from: 0.7, to: 5.0, title: "Vulcan is dying", text: "Its core is breaking up. The last shuttle lifts off." },
  { from: 5.6, to: DOCK + 0.4, title: "Reach the starship", text: "Dock before the planet comes apart." },
  { from: JUMP + 0.8, to: END - 0.7, title: "Vulcan is gone", text: "No world is left to call home. You have 15 minutes to find a new one." },
];

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
        ship.group.updateMatrixWorld(true);
      }

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
        sweep.getPoint(k, outPos).x -= 6 * smooth(ARRIVE - 0.4, END, T);
        outPos.applyMatrix4(ship.group.matrixWorld);
        const toShip = holdLookLocal.clone().lerp(shipMid, smooth(JUMP, JUMP + 1.2, T)).applyMatrix4(ship.group.matrixWorld).sub(outPos).normalize();
        const toPlanet = outPos.clone().negate().normalize();
        outLook.copy(outPos).add(toShip.lerp(toPlanet, 0.6 * smooth(JUMP + 1.5, ARRIVE, T)));
      }

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
        dust.update(dt);

        // --- Starship: hangar doors open for the shuttle, then it powers up and runs ---
        if (T >= JUMP) placeShip(T);
        const doors = smooth(ALIGN - 1.6, ALIGN - 0.4, T) * (1 - smooth(DOCK + 0.05, JUMP - 0.05, T));
        const power = smooth(DOCK + 0.2, JUMP + 0.4, T);
        animateStarship(ship, power, T, doors);
        // The hum fades as Vulcan breaks up behind the ship.
        engine(power * (1 - smooth(BOOM, END - 1, T)));

        // --- Vulcan breaks up ------------------------------------------------------
        const since = T - BOOM;
        const crack = smooth(ARRIVE - 0.8, BOOM, T);
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
        else sweepCamera(T, camPos, camLook);
        camera.position.copy(camPos);
        camera.up.copy(camPos.clone().normalize().lerp(shipUp, smooth(ALIGN - 1.8, ALIGN, T)).normalize());
        camera.lookAt(camLook);
        // A tremor as the crust splits, a jolt at the blast, another as the shock ring rolls past.
        const tremor = since < 0 ? 0.003 * crack : 0;
        const jolt = since >= 0 ? 0.025 * Math.exp(-since * 2.2) + (since > 2.2 ? 0.02 * Math.exp(-(since - 2.2) * 3) : 0) : 0;
        const shake = reduce ? 0 : tremor + jolt;
        camera.rotateX(shake * (Math.sin(T * 83) + Math.sin(T * 47)));
        camera.rotateY(shake * (Math.sin(T * 71) + Math.cos(T * 53)));
        camera.rotateZ(shake * 0.5 * Math.sin(T * 39));

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

        for (const ps of [dust, embers, smoke]) ps.setScale(camera, H * pixelRatio);
        film.uniforms.uTime.value = T;
        film.uniforms.uBlack.value = 1 - smooth(0, 1, T) * (1 - smooth(END - 0.8, END, T));
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
      <div className="letterbox top" aria-hidden="true" />
      <div className="letterbox bottom" aria-hidden="true" />
      <div className="opener-copy" aria-live="polite">
        {CAPTIONS.map((c, i) => (
          <div key={c.title} className={i === caption ? "cap show" : "cap"}>
            <p className="eyebrow">
              {String(i + 1).padStart(2, "0")} / 03 · Nova Grid
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
