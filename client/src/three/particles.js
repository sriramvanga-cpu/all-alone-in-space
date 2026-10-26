import * as THREE from "three";

// Soft round particles sized in world units (they shrink with distance), for
// dust, vapour, thruster puffs, embers and blast smoke. CPU-simulated: each
// particle has a velocity, drag, growth and a life; colour fades with age.

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.001), 0.0, 512.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uSoft;
varying float vAlpha;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vAlpha * pow(clamp(1.0 - d, 0.0, 1.0), uSoft);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticleSystem {
  constructor(max, { additive = false, soft = 1.6 } = {}) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  // p: { pos: Vector3, vel: Vector3, size, grow, life, drag, alpha, color: [r,g,b], end?: [r,g,b] }
  add(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ age: 0, drag: 0, grow: 0, alpha: 1, ...p, pos: p.pos.clone(), vel: p.vel.clone() });
  }

  clear() {
    this.list.length = 0;
  }

  // Keep the on-screen size right for the current camera and canvas height.
  setScale(camera, height) {
    this.material.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  update(dt, shift) {
    const out = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (shift) p.pos.add(shift);
      p.size += p.grow * dt;
      out.push(p);
    }
    this.list = out;
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const p = out[i];
      const k = p.age / p.life;
      const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      this.pos[i * 3] = p.pos.x;
      this.pos[i * 3 + 1] = p.pos.y;
      this.pos[i * 3 + 2] = p.pos.z;
      this.size[i] = p.size;
      this.alpha[i] = p.alpha * fade;
      const c = p.color;
      const e = p.end || c;
      this.color[i * 3] = c[0] + (e[0] - c[0]) * k;
      this.color[i * 3 + 1] = c[1] + (e[1] - c[1]) * k;
      this.color[i * 3 + 2] = c[2] + (e[2] - c[2]) * k;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

// A soft radial glow texture for sprites (sun, engine glows, flashes).
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,0.6)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.14)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color, size) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}
