/* Image viewer on the tool's WebGL 2 canvas: zoom to the cursor, pan, fit / 100 %,
   a before/after split and single-channel views. Zoom is image pixels per screen pixel
   (device pixels), so 100 % shows every texel exactly once; from 100 % up pixels are
   drawn as squares, below it the mip chain keeps the picture from shimmering. */

const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  gl_Position = vec4(p, 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;        // after, before
uniform vec2 uImg, uOff;
uniform float uZoom, uViewH, uSplit, uLodA;
uniform int uChan;
out vec4 o;
void main() {
  vec2 s = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y);
  vec2 ip = (s - uOff) / uZoom;
  if (any(lessThan(ip, vec2(0.))) || any(greaterThanEqual(ip, uImg))) { o = vec4(vec3(.055), 1.); return; }
  bool before = uSplit >= 0. && s.x < uSplit;
  vec4 c;
  if (uZoom >= 1.) {
    ivec2 t = ivec2(ip);
    c = before ? texelFetch(uB, t, 0) : texelFetch(uA, t, 0);
  } else {
    vec2 uv = ip / uImg;
    float lod = log2(1. / uZoom);
    c = before ? textureLod(uB, uv, lod) : textureLod(uA, uv, min(lod, uLodA));
  }
  vec3 rgb;
  if (uChan >= 0) rgb = vec3(c[uChan]);
  else {
    vec2 k = floor(s / 8.);
    vec3 chk = vec3(mod(k.x + k.y, 2.) > .5 ? .16 : .11);
    rgb = mix(chk, c.rgb, c.a);
  }
  if (uZoom >= 12.) {                 // pixel grid
    vec2 f = fract(ip) * uZoom;
    if (f.x < 1. || f.y < 1.) rgb = mix(rgb, vec3(0.), .22);
  }
  o = vec4(rgb, 1.);
}`;

const MIN_ZOOM = 1 / 64, MAX_ZOOM = 64;

export function createViewer(gl, canvas) {
  let p, U, vao;
  // GL objects only; called again with a new context after a GPU reset.
  function build(context) {
    gl = context;
    p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    U = Object.fromEntries(['uA', 'uB', 'uImg', 'uOff', 'uZoom', 'uViewH', 'uSplit', 'uLodA', 'uChan'].map(n => [n, gl.getUniformLocation(p, n)]));
    vao = gl.createVertexArray();
  }
  build(gl);

  const v = {
    zoom: 1, ox: 0, oy: 0,     // image origin on screen, device px
    W: 0, H: 0,
    fitted: true,              // keep fitting while the view resizes, until the user zooms
    split: -1,                 // compare divider as a fraction of the width, -1 = off
    chan: -1,                  // -1 = RGB(A), 0..3 = one channel as gray
    onChange: null,
  };
  const dpr = () => window.devicePixelRatio || 1;

  function resize() {
    const r = dpr(), w = Math.max(1, Math.round(canvas.clientWidth * r)), h = Math.max(1, Math.round(canvas.clientHeight * r));
    if (canvas.width === w && canvas.height === h) return false;
    // keep the point in the middle of the view where it was
    const cx = (canvas.width / 2 - v.ox) / v.zoom, cy = (canvas.height / 2 - v.oy) / v.zoom;
    canvas.width = w; canvas.height = h;
    if (v.fitted) fit(); else { v.ox = w / 2 - cx * v.zoom; v.oy = h / 2 - cy * v.zoom; }
    return true;
  }

  function fit() {
    if (!v.W) return;
    const pad = 16 * dpr();
    v.zoom = Math.min((canvas.width - 2 * pad) / v.W, (canvas.height - 2 * pad) / v.H, MAX_ZOOM);
    v.ox = (canvas.width - v.W * v.zoom) / 2;
    v.oy = (canvas.height - v.H * v.zoom) / 2;
    v.fitted = true;
    v.onChange?.();
  }

  // Zoom to `z`, keeping the screen point (sx, sy) (device px) over the same image point.
  function zoomAt(z, sx = canvas.width / 2, sy = canvas.height / 2) {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    v.ox = sx - (sx - v.ox) * z / v.zoom;
    v.oy = sy - (sy - v.oy) * z / v.zoom;
    v.zoom = z;
    // at 100 % and above, keep pixels on the device pixel grid
    if (z >= 1) { v.ox = Math.round(v.ox); v.oy = Math.round(v.oy); }
    v.fitted = false;
    v.onChange?.();
  }

  function setImage(W, H, keep) {
    const same = W === v.W && H === v.H;
    v.W = W; v.H = H;
    if (!keep || !same) fit();
  }

  function draw(after, before, lodA) {
    resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, after);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, before);
    gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1);
    gl.uniform2f(U.uImg, v.W, v.H);
    gl.uniform2f(U.uOff, v.ox, v.oy);
    gl.uniform1f(U.uZoom, v.zoom);
    gl.uniform1f(U.uViewH, canvas.height);
    gl.uniform1f(U.uSplit, v.split < 0 ? -1 : v.split * canvas.width);
    gl.uniform1f(U.uLodA, lodA);
    gl.uniform1i(U.uChan, v.chan);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Image point under the middle of the view: the filter starts there.
  function focus() {
    return [(canvas.width / 2 - v.ox) / v.zoom, (canvas.height / 2 - v.oy) / v.zoom];
  }

  /* ── Mouse and touch ── */
  const toDevice = e => {
    const b = canvas.getBoundingClientRect(), r = dpr();
    return [(e.clientX - b.left) * r, (e.clientY - b.top) * r];
  };
  canvas.addEventListener('wheel', e => {
    if (!v.W) return;
    e.preventDefault();
    const [x, y] = toDevice(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    zoomAt(v.zoom * Math.exp(-dy * .0015), x, y);
  }, { passive: false });

  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toDevice(e));
    canvas.classList.add('is-panning');
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = toDevice(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoomAt(v.zoom * d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = d;
      return;
    }
    v.ox += cur[0] - prev[0];
    v.oy += cur[1] - prev[1];
    v.fitted = false;
    v.onChange?.();
  });
  const up = e => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (!pointers.size) {
      canvas.classList.remove('is-panning');
      if (v.zoom >= 1) { v.ox = Math.round(v.ox); v.oy = Math.round(v.oy); v.onChange?.(); }
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', e => {
    const [x, y] = toDevice(e);
    if (Math.abs(v.zoom - 1) < 1e-6) fit(); else zoomAt(1, x, y);
  });

  return Object.assign(v, { setImage, draw, fit, zoomAt, focus, resize, build });
}
