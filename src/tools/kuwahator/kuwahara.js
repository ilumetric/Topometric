/* Anisotropic Kuwahara filter on WebGL 2 (Kyprianidis et al., with polynomial sector weights).

   For every pixel the local structure tensor gives the direction of the strokes and how
   strongly oriented they are. A disc around the pixel is stretched into an ellipse along
   that direction and split into 8 overlapping sectors; each sector's mean color is weighted
   by how flat (low variance) the sector is. Flat sectors win, so edges stay sharp while
   everything else smears into brush strokes.

   The image is processed in tiles spread over animation frames, so a large radius on an 8K
   map never stalls the page or trips the GPU watchdog. Tiles near the point the user looks
   at go first. */

const TILE = 256;
const TENSOR_SIGMA = 2;                          // structure tensor smoothing, px
const BLUR_R = Math.ceil(TENSOR_SIGMA * 3);      // also the tensor margin around a tile
const HARDNESS = 8;                              // variance scale, as in the reference implementation
const ZERO_CROSSING = .58;                       // where neighbouring sector weights meet

const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  gl_Position = vec4(p, 0., 1.);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
`;

// Structure tensor (fx², fy², fx·fy) of the channels picked by uMask, Sobel gradients.
const FS_TENSOR = HEAD + `
uniform sampler2D uSrc;
uniform ivec2 uOrigin, uSize;
uniform vec4 uMask;
vec4 px(ivec2 p) { return texelFetch(uSrc, clamp(p, ivec2(0), uSize - 1), 0); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + uOrigin;
  vec4 a = px(p + ivec2(-1, -1)), b = px(p + ivec2(0, -1)), c = px(p + ivec2(1, -1));
  vec4 d = px(p + ivec2(-1, 0)),                           f = px(p + ivec2(1, 0));
  vec4 g = px(p + ivec2(-1, 1)),  h = px(p + ivec2(0, 1)),  i = px(p + ivec2(1, 1));
  vec4 gx = (c + 2. * f + i - a - 2. * d - g) * .25;
  vec4 gy = (g + 2. * h + i - a - 2. * b - c) * .25;
  o = vec4(dot(gx * gx, uMask), dot(gy * gy, uMask), dot(gx * gy, uMask), 1.);
}`;

// Separable Gaussian blur of the tensor tile.
const FS_BLUR = HEAD + `
uniform sampler2D uT;
uniform ivec2 uDir;
uniform float uSigma;
uniform int uR;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), s = textureSize(uT, 0) - 1;
  vec4 sum = vec4(0.);
  float ws = 0.;
  for (int k = -uR; k <= uR; k++) {
    float w = exp(-float(k * k) / (2. * uSigma * uSigma));
    sum += w * texelFetch(uT, clamp(p + uDir * k, ivec2(0), s), 0);
    ws += w;
  }
  o = sum / ws;
}`;

const FS_KUWAHARA = HEAD + `
uniform sampler2D uSrc, uT;
uniform ivec2 uSize, uTOrigin;
uniform float uRadius, uAlpha, uQ, uZeta, uEta;
uniform vec4 uVarW;
vec4 px(ivec2 p) { return texelFetch(uSrc, clamp(p, ivec2(0), uSize - 1), 0); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 t = texelFetch(uT, p - uTOrigin, 0).xyz;
  float E = t.x, G = t.y, F = t.z;
  float D = sqrt((E - G) * (E - G) + 4. * F * F);
  float l1 = .5 * (E + G + D), l2 = .5 * (E + G - D);
  vec2 v = vec2(l1 - E, -F);
  vec2 dir = dot(v, v) > 1e-20 ? normalize(v) : vec2(0., 1.);
  float A = l1 + l2 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0.;
  float phi = -atan(dir.y, dir.x), cp = cos(phi), sp = sin(phi);
  float a = uRadius * clamp((uAlpha + A) / uAlpha, .1, 2.);
  float b = uRadius * clamp(uAlpha / (uAlpha + A), .1, 2.);
  mat2 SR = mat2(.5 / a, 0., 0., .5 / b) * mat2(cp, sp, -sp, cp);
  int mx = int(sqrt(a * a * cp * cp + b * b * sp * sp));
  int my = int(sqrt(a * a * sp * sp + b * b * cp * cp));

  vec4 m[8], s[8];
  float n[8], w[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.); s[k] = vec4(0.); n[k] = 0.; }

  for (int y = -my; y <= my; y++)
  for (int x = -mx; x <= mx; x++) {
    vec2 q = SR * vec2(x, y);
    float qq = dot(q, q);
    if (qq > .25) continue;
    vec4 c = px(p + ivec2(x, y));
    float vxx = uZeta - uEta * q.x * q.x, vyy = uZeta - uEta * q.y * q.y, z;
    z = max(0.,  q.y + vxx); w[0] = z * z;
    z = max(0., -q.x + vyy); w[2] = z * z;
    z = max(0., -q.y + vxx); w[4] = z * z;
    z = max(0.,  q.x + vyy); w[6] = z * z;
    vec2 r = .70710678 * vec2(q.x - q.y, q.x + q.y);
    vxx = uZeta - uEta * r.x * r.x; vyy = uZeta - uEta * r.y * r.y;
    z = max(0.,  r.y + vxx); w[1] = z * z;
    z = max(0., -r.x + vyy); w[3] = z * z;
    z = max(0., -r.y + vxx); w[5] = z * z;
    z = max(0.,  r.x + vyy); w[7] = z * z;
    float sum = 0.;
    for (int k = 0; k < 8; k++) sum += w[k];
    float g = exp(-3.125 * qq) / max(sum, 1e-8);
    vec4 cc = c * c;
    for (int k = 0; k < 8; k++) {
      float wk = w[k] * g;
      m[k] += c * wk; s[k] += cc * wk; n[k] += wk;
    }
  }

  // Sector weight 1 / (1 + (h·σ²)^(q/2)), computed in log space so a high
  // sharpness can't overflow; only the ratios between sectors matter.
  float L[8], top = -1e30;
  for (int k = 0; k < 8; k++) {
    if (n[k] <= 0.) { L[k] = -1e30; continue; }
    vec4 mean = m[k] / n[k];
    float var = dot(abs(s[k] / n[k] - mean * mean), uVarW);
    float e = .5 * uQ * log(max(${HARDNESS * 1000}. * var, 1e-30));
    L[k] = -(max(e, 0.) + log(1. + exp(-abs(e))));
    top = max(top, L[k]);
  }
  vec4 acc = vec4(0.);
  float ws = 0.;
  for (int k = 0; k < 8; k++) {
    if (n[k] <= 0.) continue;
    float wk = exp(L[k] - top);
    acc += m[k] / n[k] * wk; ws += wk;
  }
  o = ws > 0. ? acc / ws : px(p);
}`;

const FS_COPY = HEAD + `
uniform sampler2D uSrc;
void main() { o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`;

// Built-in example: warped noise in a painterly palette, so there are strokes to see on first open.
const FS_SAMPLE = HEAD + `
uniform vec2 uSize;
float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + 1.), u.x), u.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 6; i++) { v += a * n(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize.y;
  vec2 q = vec2(fbm(uv * 3.), fbm(uv * 3. + 5.2));
  vec2 r = vec2(fbm(uv * 3. + 4. * q + vec2(1.7, 9.2)), fbm(uv * 3. + 4. * q + vec2(8.3, 2.8)));
  float f = fbm(uv * 3. + 4. * r);
  vec3 c = mix(vec3(.10, .16, .32), vec3(.85, .45, .22), clamp(f * f * 2.2, 0., 1.));
  c = mix(c, vec3(.95, .85, .55), clamp(length(q) * .9 - .35, 0., 1.));
  c = mix(c, vec3(.12, .40, .38), clamp(r.x * r.x * 1.6 - .2, 0., 1.));
  c *= .75 + .5 * f;
  c += (n(gl_FragCoord.xy * .9) - .5) * .06;   // fine grain for the filter to clean up
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

function program(gl, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function target(gl, w, h, format, levels = 1) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, format, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('This GPU cannot render to the needed texture format');
  return { tex, fb, w, h };
}

function free(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}

// UI parameters (0..1 sliders, radius in px) → shader constants.
function constants({ radius, smoothness, sharpness, anisotropy }) {
  const zeta = .01 + .5 * smoothness ** 1.5;
  const sz = Math.sin(ZERO_CROSSING);
  return {
    radius: Math.max(.5, radius),
    zeta,
    eta: (zeta + Math.cos(ZERO_CROSSING)) / (sz * sz),
    q: 1 + 17 * sharpness,
    alpha: 1 / Math.max(anisotropy, 1e-3),
  };
}

export function createKuwahara(gl) {
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float textures');
  const progs = {
    tensor: program(gl, FS_TENSOR),
    blur: program(gl, FS_BLUR),
    kuwahara: program(gl, FS_KUWAHARA),
    copy: program(gl, FS_COPY),
    sample: program(gl, FS_SAMPLE),
  };
  const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  const vao = gl.createVertexArray();
  const T = TILE + 2 * BLUR_R;
  const tensorA = target(gl, T, T, gl.RGBA16F), tensorB = target(gl, T, T, gl.RGBA16F);

  let src = null, dst = null, W = 0, H = 0, opaque = true;
  let queue = [], job = null, total = 0;
  let fence = null, waited = 0, budget = 2e7;
  let mipsFresh = false;

  function draw(prog, fb, x, y, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(x, y, w, h);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  function allocate(w, h) {
    if (w > maxSize || h > maxSize) throw new Error(`Images up to ${maxSize} px are supported on this GPU`);
    free(gl, src); free(gl, dst);
    W = w; H = h;
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    src = target(gl, w, h, gl.RGBA8, levels);
    dst = target(gl, w, h, gl.RGBA8, levels);
    queue = []; job = null;
  }

  // The result starts as a copy of the source, so unfinished tiles show the original.
  function resetResult() {
    bindTex(0, src.tex);
    gl.useProgram(progs.copy.p);
    gl.uniform1i(progs.copy.u.uSrc, 0);
    draw(progs.copy, dst.fb, 0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    mipsFresh = true;
  }

  function setSource({ w, h, data }) {
    allocate(w, h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    opaque = true;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
    resetResult();
  }

  function setSample(w, h) {
    allocate(w, h);
    gl.useProgram(progs.sample.p);
    gl.uniform2f(progs.sample.u.uSize, w, h);
    draw(progs.sample, src.fb, 0, 0, w, h);
    opaque = true;
    resetResult();
  }

  // Starts (or restarts) filtering the whole image; tiles nearest to `focus` go first.
  // `params` is one set for the color mode, or an array of 4 sets (null = channel off)
  // for the per-channel mode.
  function start(params, focus = [W / 2, H / 2], mode = 'color') {
    if (!src) return;
    const pass = (ch, q) => {
      if (!q) return { ch, copy: true, cost: 1 };
      const reach = Math.max(.5, q.radius) * (q.anisotropy > 0 ? 2 : 1);
      return { ch, c: constants(q), cost: (2 * reach + 1) ** 2 * .8 };
    };
    const passes = mode === 'color' ? [pass(-1, params)]
      : (opaque ? [0, 1, 2] : [0, 1, 2, 3]).map(ch => pass(ch, params[ch]));
    job = { passes, cost: passes.reduce((a, q) => a + q.cost, 0) };
    queue = [];
    for (let y = 0; y < H; y += TILE) for (let x = 0; x < W; x += TILE) {
      const w = Math.min(TILE, W - x), h = Math.min(TILE, H - y);
      queue.push({ x, y, w, h, d: Math.hypot(x + w / 2 - focus[0], y + h / 2 - focus[1]) });
    }
    queue.sort((a, b) => b.d - a.d);               // popped from the end: nearest first
    total = queue.length;
    mipsFresh = false;
  }

  function tile({ x, y, w, h }) {
    const ox = x - BLUR_R, oy = y - BLUR_R, tw = w + 2 * BLUR_R, th = h + 2 * BLUR_R;
    for (const { ch, c, copy } of job.passes) {
      if (copy) {                                  // channel off: back to the source values
        bindTex(0, src.tex);
        gl.useProgram(progs.copy.p);
        gl.uniform1i(progs.copy.u.uSrc, 0);
        gl.colorMask(ch === 0, ch === 1, ch === 2, ch === 3);
        draw(progs.copy, dst.fb, x, y, w, h);
        gl.colorMask(true, true, true, true);
        continue;
      }
      const mask = ch < 0 ? [1, 1, 1, 0] : [0, 1, 2, 3].map(i => +(i === ch));
      const varW = ch < 0 ? (opaque ? [1, 1, 1, 0] : [1, 1, 1, 1]) : mask;
      // tensor of the tile plus margin, blurred horizontally then vertically
      bindTex(0, src.tex);
      gl.useProgram(progs.tensor.p);
      gl.uniform1i(progs.tensor.u.uSrc, 0);
      gl.uniform2i(progs.tensor.u.uOrigin, ox, oy);
      gl.uniform2i(progs.tensor.u.uSize, W, H);
      gl.uniform4fv(progs.tensor.u.uMask, mask);
      draw(progs.tensor, tensorA.fb, 0, 0, tw, th);
      gl.useProgram(progs.blur.p);
      gl.uniform1i(progs.blur.u.uT, 0);
      gl.uniform1f(progs.blur.u.uSigma, TENSOR_SIGMA);
      gl.uniform1i(progs.blur.u.uR, BLUR_R);
      bindTex(0, tensorA.tex);
      gl.uniform2i(progs.blur.u.uDir, 1, 0);
      draw(progs.blur, tensorB.fb, 0, 0, tw, th);
      bindTex(0, tensorB.tex);
      gl.uniform2i(progs.blur.u.uDir, 0, 1);
      draw(progs.blur, tensorA.fb, 0, 0, tw, th);
      // the filter itself, written straight into the result
      const k = progs.kuwahara;
      bindTex(0, src.tex);
      bindTex(1, tensorA.tex);
      gl.useProgram(k.p);
      gl.uniform1i(k.u.uSrc, 0);
      gl.uniform1i(k.u.uT, 1);
      gl.uniform2i(k.u.uSize, W, H);
      gl.uniform2i(k.u.uTOrigin, ox, oy);
      gl.uniform1f(k.u.uRadius, c.radius);
      gl.uniform1f(k.u.uAlpha, c.alpha);
      gl.uniform1f(k.u.uQ, c.q);
      gl.uniform1f(k.u.uZeta, c.zeta);
      gl.uniform1f(k.u.uEta, c.eta);
      gl.uniform4fv(k.u.uVarW, varW);
      if (ch >= 0) gl.colorMask(ch === 0, ch === 1, ch === 2, ch === 3);
      draw(k, dst.fb, x, y, w, h);
      gl.colorMask(true, true, true, true);
      bindTex(1, null);
    }
  }

  // Called once per frame. Submits as many tiles as the GPU kept up with last time.
  // Returns true while there is work left.
  function step() {
    if (fence) {
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
        if (++waited > 2) budget = Math.max(2e6, budget * .7);
        return true;
      }
      gl.deleteSync(fence);
      fence = null;
      if (waited <= 1) budget = Math.min(2e10, budget * 1.3);
      waited = 0;
    }
    if (!queue.length) return false;
    let spent = 0;
    while (queue.length && spent < budget) {
      const t = queue.pop();
      tile(t);
      spent += t.w * t.h * job.cost;
    }
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return true;
  }

  // Everything that's left, at once (before saving).
  function finish() {
    while (queue.length) tile(queue.pop());
  }

  function updateMips() {
    if (mipsFresh || queue.length) return;
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    mipsFresh = true;
  }

  function read() {
    finish();
    const px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  return {
    setSource, setSample, start, step, finish, updateMips, read, maxSize,
    get size() { return [W, H]; },
    get opaque() { return opaque; },
    get source() { return src?.tex; },
    get result() { return dst?.tex; },
    get mipsFresh() { return mipsFresh; },
    get progress() { return total ? 1 - queue.length / total : 1; },
    get busy() { return queue.length > 0 || !!fence; },
  };
}
