import * as THREE from "three";

// Photo textures from Solar System Scope (CC BY 4.0, built from NASA mission data),
// resized for the web by hand. They live in client/public/textures.
const FILES = {
  vulcan: "vulcan.jpg",
  sky: "sky.jpg",
  mercury: "mercury.jpg",
  moon: "moon.jpg",
  venus: "venus_surface.jpg",
  jupiter: "jupiter.jpg",
  saturn: "saturn.jpg",
  uranus: "uranus.jpg",
  neptune: "neptune.jpg",
  ceres: "ceres.jpg",
  eris: "eris.jpg",
  makemake: "makemake.jpg",
  haumea: "haumea.jpg",
  earth: "earth.jpg",
  mars: "mars.jpg",
  ring: "saturn_ring.png",
};

// Phones get a half-size copy of the 4096-wide Vulcan map (client/public/textures/phone): a third of the download
// and a quarter of the graphics memory, still sharper than a phone shows it. The sky stays full size: the intro
// shows it across the whole screen.
const PHONE = Math.min(screen.width, screen.height) <= 600;
const PHONE_COPIES = new Set(["vulcan"]);

let pending = null;

// Loads every texture once and caches the promise. Starts at app load, so the
// textures are usually ready before anyone presses Launch.
export function loadTextures() {
  if (pending) return pending;
  const loader = new THREE.TextureLoader();
  pending = Promise.all(
    Object.entries(FILES).map(([key, file]) =>
      loader.loadAsync(`/textures/${PHONE && PHONE_COPIES.has(key) ? "phone/" : ""}${file}`).then((tex) => {
        tex.colorSpace = key === "ring" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Planet maps are also tiled small as close-up ground detail.
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        if (key === "sky") tex.mapping = THREE.EquirectangularReflectionMapping;
        return [key, tex];
      }),
    ),
  ).then(Object.fromEntries);
  pending.catch(() => {});
  return pending;
}
