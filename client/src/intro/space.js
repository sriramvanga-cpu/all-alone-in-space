// Full-screen WebGL pass for the intro: deep space (nebula, stars, sun) and a
// procedural Vulcan with terrain, city lights, atmosphere, glowing cracks, a
// break-up dissolve, a core flash, and a flat shock ring. Everything is driven
// by uniforms, so the timeline in Intro.jsx only sets numbers each frame.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;      // CSS px
uniform float uDpr;
uniform float uTime;
uniform vec3 uPlanet;   // centre x, centre y (CSS px, y down), radius
uniform vec3 uLight;    // planet space: x right, y up, z toward the viewer
uniform float uRot;
uniform float uAtm;     // atmosphere thickness, px
uniform float uCrack;   // 0..1 glowing fissures
uniform float uBoom;    // 0..1 break-up
uniform float uFlash;   // 0..1 core flash
uniform vec4 uRing;     // radius px, intensity, y squash, rotation
uniform vec3 uSun;      // x, y, intensity
uniform vec2 uCam;      // parallax offset, px
uniform float uNeb;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm5(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.07 + vec3(4.1, 1.3, 7.7);
    a *= 0.5;
  }
  return v;
}

float ridge(vec3 p) {
  return 1.0 - abs(noise(p) * 2.0 - 1.0);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Cellular noise: x = distance to the nearest cell border, y = a random value
// for the nearest cell. Borders become fissures; cells become crust plates.
vec2 cells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 best = vec3(0.0);
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = g + hash33(i + g) - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i + g;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  return vec2(sqrt(d2) - sqrt(d1), hash13(best + 4.7));
}

vec3 starLayer(vec2 p, float cell, float seed, float density) {
  vec2 q = p / cell;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = hash12(id + seed);
  if (h < density) return vec3(0.0);
  vec2 off = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) - 0.5;
  float d = length(f - off * 0.8) * cell;
  float size = mix(0.55, 1.9, pow(hash12(id + seed + 1.3), 8.0));
  float b = exp(-d * d / (size * size)) * (0.35 + 0.65 * h);
  float tw = 0.7 + 0.3 * sin(uTime * (0.8 + 3.0 * h) + h * 50.0);
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash12(id + seed + 5.5));
  return tint * b * tw;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;

  // Space: a dark gradient, two-tone nebula, three star depths.
  vec3 col = mix(vec3(0.008, 0.01, 0.024), vec3(0.02, 0.03, 0.065), p.y / uRes.y);
  vec2 nq = (p + uCam * 0.12) / uRes.y;
  float neb = fbm3(vec3(nq * 2.4, 1.3));
  float nebTint = fbm3(vec3(nq * 3.3 + 5.2, 4.7));
  vec3 nebCol = mix(vec3(0.24, 0.1, 0.46), vec3(0.04, 0.3, 0.4), nebTint);
  col += nebCol * smoothstep(0.42, 0.82, neb) * 0.55 * uNeb;
  col += starLayer(p + uCam * 0.25, 95.0, 1.0, 0.45);
  col += starLayer(p + uCam * 0.5, 60.0, 17.0, 0.62) * 0.8;
  col += starLayer(p + uCam * 0.9, 38.0, 43.0, 0.8) * 0.6;

  // Sun: a hot core and a broad warm bloom.
  float sd = length(p - uSun.xy);
  col += uSun.z * (vec3(1.0, 0.9, 0.75) * 1.6 * exp(-sd / 18.0)
    + vec3(1.0, 0.7, 0.45) * 0.55 * exp(-sd / 120.0)
    + vec3(1.0, 0.55, 0.3) * 0.18 * exp(-sd / 480.0));

  vec2 q = (p - uPlanet.xy) / uPlanet.z;
  float d = length(q);
  vec3 L = normalize(uLight);

  // 0 for a planet seen whole, 1 for the close-up horizon of the launch.
  float zoom = smoothstep(300.0, 2500.0, uPlanet.z);

  // Atmosphere halo at and beyond the limb, brighter on the sunlit side. It is
  // added before the planet so the anti-aliased limb blends into haze, not black.
  if (d > 0.97) {
    float beyond = max(d - 1.0, 0.0) * uPlanet.z;
    float h = exp(-beyond / uAtm);
    float side = smoothstep(-0.45, 0.6, dot(normalize(vec3(q.x, -q.y, 0.0)), L));
    vec3 atm = mix(vec3(0.42, 0.55, 1.0), vec3(1.0, 0.52, 0.28), h);
    col += atm * h * (0.06 + 0.95 * side) * (1.0 + zoom * 0.9) * (1.0 - uBoom);
  }

  if (d < 1.0) {
    vec3 n = vec3(q.x, -q.y, sqrt(1.0 - d * d));
    float cr = cos(uRot);
    float sr = sin(uRot);
    vec3 np = vec3(cr * n.x + sr * n.z, n.y, -sr * n.x + cr * n.z);

    // Desert world: dark basins, red sand, pale highlands, canyon lines.
    float h = fbm5(np * 2.1 + 3.0);
    float detail = fbm5(np * 8.5);
    float relief = 0.0;
    if (zoom > 0.0) {
      // Close up, add fine terrain and fake relief by sampling toward the light.
      float fine = fbm5(np * 70.0);
      float fineL = fbm5((np + L * 0.004) * 70.0);
      float micro = fbm3(np * 320.0);
      relief = (fine - fineL) * 4.5 * zoom;
      detail = mix(detail, detail * 0.6 + fine * 0.28 + micro * 0.12, zoom);
    }
    vec3 basin = vec3(0.3, 0.1, 0.06);
    vec3 sand = vec3(0.8, 0.41, 0.21);
    vec3 high = vec3(0.98, 0.75, 0.52);
    vec3 surf = mix(basin, sand, smoothstep(0.36, 0.58, h));
    surf = mix(surf, high, smoothstep(0.6, 0.8, h + detail * 0.18));
    surf *= mix(0.78 + 0.38 * detail, 0.86 + 0.26 * detail, zoom);
    surf = mix(surf, basin * 0.8, smoothstep(0.93, 0.99, ridge(np * 4.6 + 2.0)) * 0.3);

    float ndl = dot(n, L);
    float diff = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
    float night = 1.0 - smoothstep(-0.08, 0.22, ndl);
    vec3 lit = surf * (0.025 + 1.25 * diff) * clamp(1.0 + relief, 0.35, 1.8);

    float city = smoothstep(0.7, 0.8, fbm5(np * 26.0)) * smoothstep(0.4, 0.55, h) * (1.0 - smoothstep(0.75, 0.85, h));
    lit += vec3(1.0, 0.66, 0.32) * city * night * 0.95 * (1.0 - uCrack);

    // Close up, distant ground fades into warm haze toward the horizon.
    float haze = pow(1.0 - n.z, 6.0) * zoom;
    lit = mix(lit, vec3(0.95, 0.5, 0.3) * (0.25 + 0.75 * diff), haze * 0.75);

    float fres = pow(1.0 - n.z, 2.6);
    lit += vec3(1.0, 0.52, 0.3) * fres * (0.12 + 0.88 * diff) * 0.6 * (1.0 - uBoom);

    // Fissures open along crust-plate borders, then the plates burn away one by
    // one. Skipped entirely until the crack phase so the close-ups stay cheap.
    float alpha = 1.0;
    if (uCrack > 0.0 || uBoom > 0.0) {
      vec3 warp = np * 2.6 + (vec3(noise(np * 7.0), noise(np * 7.0 + 3.1), noise(np * 7.0 + 6.2)) - 0.5) * 0.35;
      vec2 plate = cells(warp);
      vec2 small = cells(np * 6.5 + 2.0);
      float w = 0.015 + 0.06 * uCrack;
      float crack = 1.0 - smoothstep(0.0, w, plate.x);
      float hair = (1.0 - smoothstep(0.0, w * 0.6, small.x)) * smoothstep(0.3, 1.0, uCrack);
      lit = mix(lit, lit * vec3(1.3, 0.6, 0.42), uCrack * 0.6);
      lit += vec3(1.0, 0.5, 0.16) * (crack + hair * 0.55) * uCrack * 2.8;
      lit += vec3(1.0, 0.35, 0.1) * uCrack * uCrack * 0.15;

      if (uBoom > 0.0) {
        float life = plate.y * 0.85 + 0.1 + (fbm3(np * 5.0) - 0.5) * 0.12;
        float keep = 1.0 - smoothstep(life - 0.03, life, uBoom);
        float burn = smoothstep(life - 0.25, life - 0.02, uBoom);
        lit = mix(lit, vec3(1.0, 0.5, 0.2) * 1.3, uBoom * 0.4);
        lit += vec3(1.0, 0.72, 0.42) * (burn * 2.2 + crack * 1.2 * (1.0 - uBoom));
        alpha = keep;
      }
    }
    alpha *= smoothstep(1.0, 1.0 - 1.6 / uPlanet.z, d);
    col = mix(col, lit, alpha);
  }

  // Core flash.
  float cd = length(p - uPlanet.xy);
  col += vec3(1.0, 0.92, 0.8) * uFlash * (3.0 * exp(-cd / (uPlanet.z * 0.7))
    + 0.7 * exp(-cd / (uPlanet.z * 4.0)) + 0.1);

  // Flat shock ring, like a wave racing out along the old equator.
  if (uRing.y > 0.0) {
    vec2 rq = p - uPlanet.xy;
    float cs = cos(uRing.w);
    float sn = sin(uRing.w);
    rq = vec2(cs * rq.x + sn * rq.y, -sn * rq.x + cs * rq.y);
    float e = length(vec2(rq.x, rq.y / uRing.z));
    float w = max(5.0, uRing.x * 0.03);
    float core = exp(-pow((e - uRing.x) / w, 2.0));
    float glow = exp(-abs(e - uRing.x) / (w * 5.0));
    float inner = smoothstep(uRing.x, uRing.x * 0.15, e) * 0.16;
    col += (vec3(0.8, 0.92, 1.0) * core * 1.8 + vec3(1.0, 0.6, 0.32) * (glow * 0.45 + inner)) * uRing.y;
  }

  vec2 v = p / uRes - 0.5;
  col *= 1.0 - dot(v, v) * 0.85;
  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

const UNIFORMS = [
  "uRes", "uDpr", "uTime", "uPlanet", "uLight", "uRot", "uAtm", "uCrack",
  "uBoom", "uFlash", "uRing", "uSun", "uCam", "uNeb",
];

export function createSpaceRenderer(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("intro shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("intro shader link:", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const loc = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
  let size = { w: 1, h: 1, dpr: 1 };

  return {
    resize(w, h, dpr) {
      size = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    render(u) {
      gl.uniform2f(loc.uRes, size.w, size.h);
      gl.uniform1f(loc.uDpr, size.dpr);
      gl.uniform1f(loc.uTime, u.time);
      gl.uniform3f(loc.uPlanet, u.planet[0], u.planet[1], u.planet[2]);
      gl.uniform3f(loc.uLight, u.light[0], u.light[1], u.light[2]);
      gl.uniform1f(loc.uRot, u.rot);
      gl.uniform1f(loc.uAtm, u.atm);
      gl.uniform1f(loc.uCrack, u.crack);
      gl.uniform1f(loc.uBoom, u.boom);
      gl.uniform1f(loc.uFlash, u.flash);
      gl.uniform4f(loc.uRing, u.ring[0], u.ring[1], u.ring[2], u.ring[3]);
      gl.uniform3f(loc.uSun, u.sun[0], u.sun[1], u.sun[2]);
      gl.uniform2f(loc.uCam, u.cam[0], u.cam[1]);
      gl.uniform1f(loc.uNeb, u.neb);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    // Free our objects but keep the context: a remount reuses the same canvas.
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
