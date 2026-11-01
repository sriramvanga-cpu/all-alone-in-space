import * as THREE from "three";

// Procedural 3D models. Every model faces +X with +Y up, so a top-down view
// matches the 2D art: the starship uses the same units and layout as
// art/Ship.jsx (saucer at x = 11.4, nacelles at z = ±8.16), and the station
// uses art/Station.jsx's units (outer ring radius 28).

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Hull plating: grey panels of slightly different tone with recessed seams.
// Used as the colour map and the bump map of the hull metal.
let panelTexture = null;
function hullPanels() {
  if (panelTexture) return panelTexture;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");
  const rand = lcg(0x2f7a);
  g.fillStyle = "#c9cfd8";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 520; i++) {
    const w = 18 + rand() * 120;
    const h = 10 + rand() * 60;
    const x = rand() * c.width;
    const y = rand() * c.height;
    const tone = 188 + Math.floor(rand() * 34);
    g.fillStyle = `rgb(${tone},${tone + 3},${tone + 8})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = "rgba(70,78,92,0.55)";
    g.lineWidth = 1.2;
    g.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + rand() * 0.05})`;
    g.fillRect(rand() * c.width, rand() * c.height, 2, 2);
  }
  panelTexture = new THREE.CanvasTexture(c);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  panelTexture.wrapS = THREE.RepeatWrapping;
  panelTexture.wrapT = THREE.RepeatWrapping;
  panelTexture.anisotropy = 8;
  return panelTexture;
}

function hullMaterial(repeat = [2, 1], color = "#e4e9f1") {
  const tex = hullPanels().clone();
  tex.repeat.set(repeat[0], repeat[1]);
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color,
    map: tex,
    bumpMap: tex,
    bumpScale: 0.8,
    metalness: 0.55,
    roughness: 0.42,
  });
}

function glow(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({
    color: "#111111",
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    metalness: 0,
    roughness: 0.6,
  });
}

const REGISTRY = "NGX-18";
const STRIPE = "#b3412c";
const LETTERING = "#2a2f3a";

// Saucer livery in the lathe's UVs: u runs round the rim, v from the bottom centre (0) over the
// rim to the top centre (1), 1/13 per profile point. Aztec plating, a dark rim band, red
// pinstripes and the registry round the top.
function saucerLivery() {
  const W = 2048;
  const H = 1024;
  const step = H / 13;
  const yAt = (k) => H - k * step;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const cw = W / 128;
  const ch = step / 4;
  for (let row = 0; row < 52; row++) {
    for (let col = 0; col < 128; col++) {
      // Two-tone 2×2 blocks with one corner cell flipped give the interlocking "aztec" look.
      const block = (Math.floor(col / 2) + Math.floor(row / 2)) % 2;
      const flip = col % 2 === 0 && row % 2 === 0 && (col + row) % 4 === 0 ? 1 : 0;
      const tone = block ^ flip ? 216 : 199;
      g.fillStyle = `rgb(${tone},${tone + 3},${tone + 9})`;
      g.fillRect(col * cw, H - (row + 1) * ch, cw + 0.5, ch + 0.5);
    }
  }
  g.strokeStyle = "rgba(60,68,82,0.4)";
  for (let x = 0; x <= W; x += cw * 2) g.strokeRect(x, 0, 0, H);
  for (let y = 0; y <= H; y += ch * 2) g.strokeRect(0, y, W, 0);
  g.fillStyle = "rgba(78,88,104,0.6)";
  g.fillRect(0, yAt(7.6), W, step * 2);
  g.fillStyle = STRIPE;
  for (const k of [4, 9.08, 9.92]) g.fillRect(0, yAt(k) - 3, W, 6);
  // u = 0 (±W) and u = 0.5 face the ship's sides. A texel here is ~1.55× wider than tall on the hull.
  g.fillStyle = LETTERING;
  g.font = `900 ${step * 0.6}px "Arial Black", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const cx of [0, W / 2, W]) {
    g.save();
    g.translate(cx, yAt(9.5));
    g.scale(1.55, 1);
    g.fillText(REGISTRY, 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A flat label (red pinstripe over lettering) laid just off the hull.
function decal(text, w, h) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const g = c.getContext("2d");
  g.fillStyle = STRIPE;
  g.fillRect(0, 0, c.width, c.height * 0.12);
  g.fillStyle = LETTERING;
  g.font = `900 ${c.height * 0.6}px "Arial Black", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height * 0.6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      metalness: 0.4,
      roughness: 0.5,
    }),
  );
}

// Bands that slide round a bussard collector as it spins.
let swirlTexture = null;
function swirl() {
  if (swirlTexture) return swirlTexture;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  for (let x = 0; x < 256; x++) {
    const v = Math.round(150 + 105 * Math.sin((x / 256) * Math.PI * 12));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 64);
  }
  swirlTexture = new THREE.CanvasTexture(c);
  return swirlTexture;
}

// A box stretched between two points, for pylons, struts and spokes.
function beam(a, b, thick, wide, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, thick, wide), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
  return mesh;
}

// Lathe a (radius, along-axis) profile into a body that runs along +X.
function latheX(profile, segments = 64) {
  const geo = new THREE.LatheGeometry(profile.map(([r, t]) => new THREE.Vector2(r, t)), segments);
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

// --- Starship -----------------------------------------------------------------

export function buildStarship() {
  const group = new THREE.Group();
  const metal = hullMaterial([3, 1]);
  const darkMetal = new THREE.MeshStandardMaterial({ color: "#8a94a6", metalness: 0.7, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: "#1b3552", metalness: 0.9, roughness: 0.12, emissive: "#0c2a48", emissiveIntensity: 0.6 });

  // Saucer: a lathe profile from the underside, out to the rim, and over the top.
  const saucerProfile = [
    [0.01, -1.0], [0.9, -0.95], [2.0, -0.8], [3.8, -0.6], [5.6, -0.4], [6.7, -0.2], [7.0, -0.04],
    [7.0, 0.06], [6.75, 0.22], [5.8, 0.42], [4.0, 0.66], [2.2, 0.88], [1.2, 1.02], [0.01, 1.08],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const saucerPlates = hullPanels().clone();
  saucerPlates.repeat.set(3, 1);
  saucerPlates.needsUpdate = true;
  const saucerMetal = new THREE.MeshStandardMaterial({
    map: saucerLivery(),
    bumpMap: saucerPlates,
    bumpScale: 0.6,
    metalness: 0.55,
    roughness: 0.42,
  });
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 128), saucerMetal);
  saucer.position.set(11.4, 1.7, 0);
  group.add(saucer);
  const windowMat = glow("#fff1d6", 1.8);

  // Bridge tower: a lit deck, a smaller deck, then the dome.
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 2.05, 0.32, 64), metal);
  deck.position.set(11.4, 2.74, 0);
  const deckWindows = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.035, 6, 96), windowMat);
  deckWindows.position.set(11.4, 2.74, 0);
  deckWindows.rotation.x = Math.PI / 2;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.2, 0.3, 48), metal);
  tower.position.set(11.4, 3.05, 0);
  group.add(deck, deckWindows, tower);
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  bridge.position.set(11.4, 3.2, 0);
  bridge.scale.set(1, 0.55, 1);
  group.add(bridge);

  // Impulse deck on the aft rim of the saucer, its engines facing astern.
  const impulseDeck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 2.8), metal);
  impulseDeck.position.set(6.5, 2.28, 0);
  group.add(impulseDeck);
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), darkMetal);
  sensor.position.set(11.4, 0.72, 0);
  sensor.scale.set(1, 0.35, 1);
  group.add(sensor);

  // Secondary hull, open at the stern for the hangar, with a glowing deflector dish.
  const hullMetal = hullMaterial([2, 1]);
  // Duller than the rest, so the sun doesn't flare off it when seen from astern.
  hullMetal.roughness = 0.62;
  const hull = new THREE.Mesh(
    latheX([[1.3, -10.55], [1.9, -9.8], [2.2, -6.0], [2.3, -1.0], [2.0, 3.0], [1.5, 5.4], [0.9, 6.4], [0.01, 6.7]]),
    hullMetal,
  );
  hull.position.set(0, -1.2, 0);
  group.add(hull);
  const dish = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), glow("#ff9a50", 0.6));
  dish.position.set(6.62, -1.2, 0);
  dish.rotation.y = Math.PI / 2;
  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.1, 12, 48), darkMetal);
  dishRim.position.set(6.6, -1.2, 0);
  dishRim.rotation.y = Math.PI / 2;
  const dishCore = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), glow("#fff0c0", 2));
  dishCore.position.set(6.64, -1.2, 0);
  dishCore.rotation.y = Math.PI / 2;
  group.add(dish, dishRim, dishCore);

  // Registry on both sides of the secondary hull, below the window row, tilted to the curve.
  const tilt = Math.asin(0.65 / 2.25);
  for (const side of [1, -1]) {
    const label = decal(REGISTRY, 5.2, 0.9);
    label.position.set(-4.0, -1.85, side * 2.19);
    label.rotation.set(side * tilt, side > 0 ? 0 : Math.PI, 0);
    group.add(label);
  }

  // Hangar: a stern plate with a door-sized mouth, a lit bay behind it, and two sliding doors.
  const plate = new THREE.Shape();
  plate.absarc(0, 0, 1.3, 0, Math.PI * 2);
  const mouth = new THREE.Path([new THREE.Vector2(-0.8, -0.5), new THREE.Vector2(0.8, -0.5), new THREE.Vector2(0.8, 0.5), new THREE.Vector2(-0.8, 0.5)]);
  plate.holes.push(mouth);
  const stern = new THREE.Mesh(new THREE.ShapeGeometry(plate, 32), darkMetal);
  stern.position.set(-10.55, -1.2, 0);
  stern.rotation.y = -Math.PI / 2;
  group.add(stern);
  const bayLight = hullPanels().clone();
  bayLight.needsUpdate = true;
  const hangar = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.0, 1.6),
    new THREE.MeshStandardMaterial({ color: "#3a404a", emissive: "#ffe6c0", emissiveMap: bayLight, emissiveIntensity: 1.1, side: THREE.BackSide }),
  );
  hangar.position.set(-9.25, -1.2, 0);
  group.add(hangar);
  const doorMetal = hullMaterial([0.3, 0.3]);
  // Doors overlap the mouth a little so the lit bay can't glow through the seams.
  const doors = [0.28, -0.28].map((y) => {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.56, 1.7), doorMetal);
    door.position.set(-10.6, -1.2 + y, 0);
    door.userData.closedY = door.position.y;
    group.add(door);
    return door;
  });

  // Neck from the hull up to the saucer.
  const neckShape = new THREE.Shape([
    new THREE.Vector2(0.8, -0.4), new THREE.Vector2(4.2, -0.4), new THREE.Vector2(10.0, 0.9), new THREE.Vector2(7.4, 0.9),
  ]);
  const neck = new THREE.Mesh(
    new THREE.ExtrudeGeometry(neckShape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 }),
    metal,
  );
  neck.position.z = -0.55;
  group.add(neck);

  // Nacelles on swept pylons: segmented blue grilles on the inner faces, spinning red collectors
  // under glass up front, a red pinstripe on top and the ship's name outboard.
  const bussards = [];
  const grilles = [];
  const spinners = [];
  const coreGeo = new THREE.SphereGeometry(0.8, 32, 16).rotateZ(Math.PI / 2);
  const shell = new THREE.MeshStandardMaterial({
    color: "#ff8a60",
    emissive: "#ff4a20",
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.35,
    metalness: 0.1,
    roughness: 0.05,
  });
  const stripe = new THREE.MeshStandardMaterial({ color: STRIPE, metalness: 0.3, roughness: 0.5 });
  for (const z of [-8.16, 8.16]) {
    const side = Math.sign(z);
    const body = new THREE.Mesh(latheX([[0.01, -11.4], [0.7, -11.2], [0.95, -10.4], [1.0, -6.0], [1.0, 3.4], [0.92, 4.1]], 48), metal);
    body.position.set(0, 2.6, z);
    group.add(body);
    const coreMat = glow("#ff5a2e", 2.2);
    coreMat.emissiveMap = swirl();
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.scale.set(1.15, 1, 1);
    core.position.set(4.15, 2.6, z);
    core.userData.spin = side;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 32, 16), shell);
    dome.scale.set(1.15, 1, 1);
    dome.position.set(4.15, 2.6, z);
    group.add(core, dome);
    bussards.push(coreMat);
    spinners.push(core);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.7, 0.64, 0.06), darkMetal);
    frame.position.set(-3.6, 2.6, z - side * 0.95);
    group.add(frame);
    const grilleMat = glow("#5ec8ff", 1.2);
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.79, 0.5, 0.08), grilleMat);
      seg.position.set(-9.35 + i * 1.94 + 0.895, 2.6, z - side * 0.97);
      group.add(seg);
    }
    grilles.push(grilleMat);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(9, 0.03, 0.16), stripe);
    pin.position.set(-3, 3.6, z);
    group.add(pin);
    const name = decal("NOVA", 4.2, 0.62);
    name.position.set(-3.4, 2.6, z + side * 1.02);
    if (side < 0) name.rotation.y = Math.PI;
    group.add(name);
    group.add(beam(new THREE.Vector3(-2.8, 0.3, side * 1.2), new THREE.Vector3(-5.0, 2.3, z - side * 0.6), 0.28, 1.7, metal));
  }

  // Impulse engines and window rows.
  const impulse = glow("#ff6a3a", 2.4);
  for (const z of [-0.65, 0.65]) {
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 1.1), impulse);
    eng.position.set(5.48, 2.3, z);
    group.add(eng);
  }
  const windowGeo = new THREE.BoxGeometry(0.14, 0.07, 0.07);
  const spots = [];
  const rand = lcg(0x77aa);
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    if (rand() < 0.22) continue;
    spots.push([11.4 + Math.cos(a) * 6.98, 1.72, Math.sin(a) * 6.98, a]);
  }
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    if (rand() < 0.3) continue;
    // Inside the registry band, clear of the lettering.
    spots.push([11.4 + Math.cos(a) * 3.4, 2.45, Math.sin(a) * 3.4, a]);
  }
  for (let x = -8.5; x < 3.5; x += 0.55) {
    for (const z of [-2.26, 2.26]) if (rand() > 0.25) spots.push([x, -0.95, z, z > 0 ? Math.PI / 2 : -Math.PI / 2]);
  }
  const windows = new THREE.InstancedMesh(windowGeo, windowMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, y, z, a], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    windows.setMatrixAt(i, m);
  });
  group.add(windows);

  // Navigation lights: red to port, green to starboard, white strobes aft.
  const navRed = glow("#ff3030", 3);
  const navGreen = glow("#30ff80", 3);
  const strobe = glow("#ffffff", 4);
  const lightGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const red = new THREE.Mesh(lightGeo, navRed);
  red.position.set(11.4, 1.72, -7.05);
  const green = new THREE.Mesh(lightGeo, navGreen);
  green.position.set(11.4, 1.72, 7.05);
  group.add(red, green);
  for (const z of [-8.16, 8.16]) {
    const s = new THREE.Mesh(lightGeo, strobe);
    s.position.set(-11.5, 2.6, z);
    group.add(s);
  }

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  return {
    group,
    bussards,
    grilles,
    spinners,
    impulse,
    dish: dish.material,
    windows: windowMat,
    navRed,
    navGreen,
    strobe,
    doors,
    // Where a shuttle comes to rest inside the hangar.
    bay: new THREE.Vector3(-9.3, -1.2, 0),
  };
}

// Sets engine glow, blinking lights and the hangar doors. power and doors 0..1, t in seconds.
export function animateStarship(ship, power, t, doors = 0) {
  ship.doors.forEach((d, i) => (d.position.y = d.userData.closedY + (i ? -0.5 : 0.5) * doors));
  for (const b of ship.bussards) b.emissiveIntensity = 1.2 + 2.6 * power + 0.3 * Math.sin(t * 7);
  for (const s of ship.spinners) s.rotation.x = s.userData.spin * t * (1 + 4 * power);
  for (const g of ship.grilles) g.emissiveIntensity = 0.4 + 1.6 * power;
  ship.impulse.emissiveIntensity = 1.2 + 2.5 * power;
  ship.dish.emissiveIntensity = 0.5 + 0.8 * power;
  const blink = (t * 0.8) % 1 < 0.12 ? 6 : 0.2;
  ship.navRed.emissiveIntensity = blink;
  ship.navGreen.emissiveIntensity = blink;
  ship.strobe.emissiveIntensity = (t * 1.1 + 0.4) % 1 < 0.06 ? 10 : 0;
}

// --- Shuttlecraft ---------------------------------------------------------------

export function buildShuttle() {
  const group = new THREE.Group();
  const metal = hullMaterial([1, 1], "#eef1f6");
  const profile = new THREE.Shape([
    new THREE.Vector2(-0.62, -0.13), new THREE.Vector2(-0.62, 0.17), new THREE.Vector2(0.18, 0.17),
    new THREE.Vector2(0.52, 0.05), new THREE.Vector2(0.62, -0.02), new THREE.Vector2(0.56, -0.11), new THREE.Vector2(-0.62, -0.13),
  ]);
  const hullGeo = new THREE.ExtrudeGeometry(profile, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3 });
  hullGeo.translate(0, 0, -0.2);
  group.add(new THREE.Mesh(hullGeo, metal));

  const glass = new THREE.MeshStandardMaterial({ color: "#0d2440", metalness: 0.9, roughness: 0.08, emissive: "#0a2850", emissiveIntensity: 0.5 });
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.42), glass);
  shield.position.set(0.37, 0.12, 0);
  shield.rotation.z = -0.34;
  group.add(shield);
  for (const z of [-0.236, 0.236]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.01), glass);
    side.position.set(0.05, 0.08, z);
    group.add(side);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.025, 0.01), new THREE.MeshStandardMaterial({ color: "#b8452c", metalness: 0.3, roughness: 0.5 }));
    stripe.position.set(-0.06, -0.03, z);
    group.add(stripe);
  }

  const bussards = [];
  const grilles = [];
  for (const z of [-0.33, 0.33]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.72, 6, 16), metal);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(-0.12, 0.0, z);
    group.add(pod);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), glow("#ff5a2e", 2.5));
    cap.position.set(0.3, 0.0, z);
    group.add(cap);
    bussards.push(cap.material);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.01), glow("#5ec8ff", 2));
    grille.position.set(-0.15, 0.02, z + Math.sign(z) * 0.056);
    group.add(grille);
    grilles.push(grille.material);
    group.add(beam(new THREE.Vector3(-0.15, 0.0, Math.sign(z) * 0.22), new THREE.Vector3(-0.2, 0.0, z), 0.03, 0.18, metal));
  }
  const impulse = glow("#ff6a3a", 3);
  const imp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.3), impulse);
  imp.position.set(-0.66, 0.06, 0);
  group.add(imp);

  return {
    group,
    bussards,
    grilles,
    impulse,
    under: [[0.25, -0.15, 0.12], [0.25, -0.15, -0.12], [-0.35, -0.15, 0.12], [-0.35, -0.15, -0.12]].map((p) => new THREE.Vector3(...p)),
    aft: [new THREE.Vector3(-0.68, 0.06, 0), new THREE.Vector3(-0.56, 0, 0.33), new THREE.Vector3(-0.56, 0, -0.33)],
    nose: new THREE.Vector3(0.64, -0.02, 0),
  };
}

export function animateShuttle(shuttle, thrust, t) {
  for (const b of shuttle.bussards) b.emissiveIntensity = 1.5 + 1.5 * thrust + 0.3 * Math.sin(t * 9);
  for (const g of shuttle.grilles) g.emissiveIntensity = 1 + 2.5 * thrust;
  shuttle.impulse.emissiveIntensity = 1.5 + 4 * thrust;
}

// --- Station ----------------------------------------------------------------------

export function buildStation() {
  const group = new THREE.Group();
  const metal = hullMaterial([6, 1]);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(28, 2.4, 24, 160), metal);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(17, 1.2, 16, 120), metal);
  inner.rotation.x = Math.PI / 2;
  group.add(inner);
  const lights = glow("#cfeeff", 2.4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    group.add(beam(dir.clone().multiplyScalar(5), dir.clone().multiplyScalar(27), 1.0, 1.6, metal));
    const bay = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.2, 5.4), metal);
    bay.position.copy(dir.clone().multiplyScalar(28));
    bay.rotation.y = -a;
    group.add(bay);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.0), lights);
    win.position.copy(dir.clone().multiplyScalar(28)).setY(1.65);
    win.rotation.y = -a;
    group.add(win);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 16), metal);
  hub.scale.y = 0.6;
  group.add(hub);
  const core = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 12), glow("#ffc070", 4));
  core.position.y = 2.4;
  group.add(core);
  return { group };
}
