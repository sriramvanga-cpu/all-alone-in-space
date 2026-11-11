import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadTextures } from "./assets.js";
import { animateStarship, buildStarship } from "./models.js";
import { LIGHT, buildPlanet, lookOf } from "./sprites.js";

// The starship is about 46 units long and its middle is 3.5 units ahead of its origin; scaled so it is
// 0.65 of a planet radius long.
const SHIP_SCALE = 0.65 / 46;
const SHIP_MID = 3.5;
const FRAME_MS = 1000 / 30;

/**
 * A live planet turning slowly with the player's ship circling it, in a transparent canvas that fills its
 * box. The box is laid out larger than the picture it replaces, so the ship's orbit has room outside the
 * planet. Calls onReady after its first frame and onFail if WebGL can't start; the caller keeps the
 * planet's still picture under it for both.
 */
export default function PlanetView({ face, onReady, onFail }) {
  const box = useRef(null);
  const calls = useRef({});
  calls.current = { onReady, onFail };
  useEffect(() => {
    let dead = false;
    let stop = () => {};
    loadTextures()
      .then((tex) => {
        if (!dead) stop = start(box.current, face, tex, calls.current);
      })
      .catch(() => calls.current.onFail?.());
    return () => {
      dead = true;
      stop();
    };
  }, [face.uid]);
  return <div className="planet-view" ref={box} aria-hidden="true" />;
}

function start(el, face, tex, calls) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    calls.onFail?.();
    return () => {};
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);

  const spec = lookOf(face, tex);
  const planet = buildPlanet(spec, tex);
  // Half the view's height, and the ship's orbit, in planet radii: ringed worlds need more room.
  const reach = spec.ring ? 2.5 : 1.7;
  const orbit = spec.ring ? 2.35 : 1.45;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 1.2;
  scene.add(new THREE.DirectionalLight("#ffffff", 2.4).translateOnAxis(LIGHT, 10));
  scene.add(new THREE.AmbientLight("#ffffff", 0.08));
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
    watch.disconnect();
    planet.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
