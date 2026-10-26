import * as THREE from "three";
import { NOISE } from "./glsl.js";

// Photo-textured planet surface. On top of the texture it adds relief from the
// texture's brightness, close-up terrain detail, night-side city lights, warm
// haze toward the horizon, and (for Vulcan's end) glowing fissures and a
// plate-by-plate break-up. Works in world space so it can be lit by a sun.

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vAxis;
void main() {
  vUv = uv;
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAxis = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform vec2 texel;
uniform vec3 sunDir;
uniform vec3 tint;
uniform float relief;
uniform float detail;
uniform float city;
uniform float crack;
uniform float boom;
uniform vec3 rimColor;
uniform float rimStrength;
uniform vec3 hazeColor;
uniform float hazeAmount;
uniform float hazeDist;
uniform float ambient;
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vAxis;
${NOISE}

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  #include <logdepthbuf_fragment>
  vec3 base = texture2D(map, vUv).rgb * tint;
  vec3 N0 = normalize(vNormalW);
  vec3 east = normalize(cross(vAxis, N0) + vec3(1e-5));
  vec3 north = cross(N0, east);

  // Relief: tilt the normal along the texture's brightness gradient.
  float hC = lum(base);
  float hU = lum(texture2D(map, vUv + vec2(texel.x, 0.0)).rgb * tint);
  float hV = lum(texture2D(map, vUv + vec2(0.0, texel.y)).rgb * tint);
  vec3 N = normalize(N0 - relief * ((hU - hC) * east + (hV - hC) * north));

  vec3 albedo = base;
  float dist = length(cameraPosition - vWorld);
  float near = detail * (1.0 - smoothstep(14.0, 110.0, dist));
  if (near > 0.001) {
    // Close to the ground the texture is too coarse: add dunes, rocks and grit.
    vec3 P = vObj;
    float d1 = fbm5(P * 900.0);
    float d2 = fbm3(P * 3800.0);
    float d1e = fbm5((P + east * 0.0004) * 900.0);
    float d1n = fbm5((P + north * 0.0004) * 900.0);
    // Detail from the photo itself, tiled small: real-looking ground at any scale.
    float avg = max(lum(base), 0.05);
    float t1 = lum(texture2D(map, vUv * 61.0).rgb * tint) / avg;
    float t2 = lum(texture2D(map, vUv * 397.0).rgb * tint) / avg;
    float rock = smoothstep(0.55, 0.7, fbm3(P * 260.0));
    vec3 ground = albedo * clamp(0.35 + 0.4 * t1 + 0.25 * t2, 0.3, 1.6) * (0.8 + 0.4 * d1);
    ground = mix(ground, albedo * vec3(0.45, 0.32, 0.28), rock * 0.6);
    albedo = mix(albedo, ground, near);
    N = normalize(N - near * 5.0 * ((d1e - d1) * east + (d1n - d1) * north));
  }

  float ndl = dot(N, sunDir);
  float diff = clamp((ndl + 0.06) / 1.06, 0.0, 1.0);
  float day = smoothstep(-0.12, 0.18, dot(N0, sunDir));
  vec3 col = albedo * (ambient + 1.45 * diff);

  // City lights on the night side, kept to lowlands and away from the poles.
  if (city > 0.0) {
    float lights = smoothstep(0.7, 0.8, fbm5(vObj * 70.0)) * smoothstep(0.15, 0.45, hC) * (1.0 - abs(vObj.y));
    col += vec3(1.0, 0.62, 0.28) * lights * (1.0 - day) * city * 1.6;
  }

  // Atmosphere seen edge-on over the disc, brighter on the day side.
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
  col += rimColor * rim * (0.08 + 0.92 * smoothstep(-0.25, 0.5, dot(N0, sunDir))) * rimStrength;

  // Haze toward the horizon when flying low.
  if (hazeAmount > 0.0) {
    float fog = (1.0 - exp(-dist / hazeDist)) * hazeAmount;
    col = mix(col, hazeColor * (0.25 + 0.95 * max(dot(N0, sunDir), 0.0)), clamp(fog, 0.0, 1.0));
  }

  // Fissures, then plates burn away. Skipped until needed.
  if (crack > 0.0 || boom > 0.0) {
    vec3 warp = vObj * 2.6 + (vec3(noise3(vObj * 7.0), noise3(vObj * 7.0 + 3.1), noise3(vObj * 7.0 + 6.2)) - 0.5) * 0.35;
    vec2 plate = cells(warp);
    vec2 small = cells(vObj * 6.5 + 2.0);
    float w = 0.015 + 0.06 * crack;
    float fissure = 1.0 - smoothstep(0.0, w, plate.x);
    float hair = (1.0 - smoothstep(0.0, w * 0.6, small.x)) * smoothstep(0.3, 1.0, crack);
    col = mix(col, col * vec3(1.15, 0.55, 0.4), crack * 0.5);
    col += vec3(2.6, 0.9, 0.22) * (fissure + hair * 0.5) * crack * 0.9;
    if (boom > 0.0) {
      float life = plate.y * 0.85 + 0.1 + (fbm3(vObj * 5.0) - 0.5) * 0.12;
      if (boom > life) discard;
      float burn = smoothstep(life - 0.25, life - 0.02, boom);
      col = mix(col, vec3(1.6, 0.6, 0.2), boom * 0.4);
      col += vec3(4.0, 2.0, 0.9) * (burn * 1.4 + fissure * (1.0 - boom));
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makePlanetMaterial({ map, tint = [1, 1, 1], relief = 6, detail = 0, city = 0 }) {
  const img = map.image;
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      map: { value: map },
      texel: { value: new THREE.Vector2(1 / (img?.width || 2048), 1 / (img?.height || 1024)) },
      sunDir: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
      tint: { value: new THREE.Color(...tint) },
      relief: { value: relief },
      detail: { value: detail },
      city: { value: city },
      crack: { value: 0 },
      boom: { value: 0 },
      rimColor: { value: new THREE.Color(1.0, 0.5, 0.28) },
      rimStrength: { value: 0.7 },
      hazeColor: { value: new THREE.Color(0.95, 0.52, 0.32) },
      hazeAmount: { value: 0 },
      hazeDist: { value: 300 },
      ambient: { value: 0.012 },
    },
  });
}

// Atmosphere as a shell: per pixel it traces the view ray through the air between
// the ground and the top of the atmosphere, so the limb glows from space and the
// sky glows from the ground, both brightest toward the sun.
const ATM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const ATM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 center;
uniform float radius;
uniform float top;
uniform vec3 sunDir;
uniform vec3 lowColor;
uniform vec3 highColor;
uniform float strength;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = cameraPosition - center;
  vec3 rd = normalize(vWorld - cameraPosition);
  float b = dot(ro, rd);
  float h = b * b - (dot(ro, ro) - top * top);
  if (h < 0.0) discard;
  h = sqrt(h);
  float t0 = max(-b - h, 0.0);
  float t1 = -b + h;
  float hp = b * b - (dot(ro, ro) - radius * radius);
  if (hp > 0.0) {
    float tp = -b - sqrt(hp);
    if (tp > 0.0) t1 = min(t1, tp);
  }
  float len = max(t1 - t0, 0.0);
  vec3 mid = ro + rd * (t0 + t1) * 0.5;
  float alt = clamp((length(mid) - radius) / (top - radius), 0.0, 1.0);
  float thick = top - radius;
  float depth = 1.0 - exp(-len / thick * 0.32 * exp(-alt * 2.5));
  float lit = smoothstep(-0.35, 0.45, dot(normalize(mid), sunDir));
  float mu = max(dot(rd, sunDir), 0.0);
  float glow = 0.6 + 1.2 * pow(mu, 5.0) + 3.0 * pow(mu, 90.0);
  // Thin air reads dusky blue-violet; long paths (horizon, limb) go warm orange.
  vec3 tone = mix(highColor * 0.4, lowColor * 1.25, smoothstep(0.25, 0.95, depth));
  vec3 col = tone * depth * lit * glow * strength;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeAtmosphereMaterial({ radius, top, strength = 1 }) {
  return new THREE.ShaderMaterial({
    vertexShader: ATM_VERT,
    fragmentShader: ATM_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      center: { value: new THREE.Vector3() },
      radius: { value: radius },
      top: { value: top },
      sunDir: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
      lowColor: { value: new THREE.Color(1.0, 0.5, 0.26) },
      highColor: { value: new THREE.Color(0.45, 0.55, 1.0) },
      strength: { value: strength },
    },
  });
}
