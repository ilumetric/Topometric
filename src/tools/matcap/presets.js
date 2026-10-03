// Default parameters and presets. A preset lists only what differs from DEFAULTS.
// Colors are sRGB hex; light x/y is where the highlight sits on the sphere (unit disc, y up).

export const DEFAULTS = {
  mode: 'shaded',
  base: '#b8b0a8', ambient: .35, sky: '#ffffff', ground: '#4a4440',
  scatter: 0, scatterColor: '#e0503a',
  lights: [{ x: -.35, y: .45, color: '#ffffff', intensity: 1, softness: .3 }],
  spec: .3, roughness: .35, specColor: '#ffffff',
  refl: 0, blur: .2, metal: 0, env: 'studio', envRot: 0,
  rim: 0, rimWidth: .5, rimColor: '#ffffff',
  toon: false, steps: 2, toonSoft: .1,
  outline: 0, outlineColor: '#111111',
  stripes: 0, stripeAngle: 0, stripeWidth: .5, stripeColor: '#111111',
  exposure: 0, contrast: 0, saturation: 1, grain: 0,
};

const L = (x, y, intensity = 1, softness = .3, color = '#ffffff') => ({ x, y, color, intensity, softness });

export const PRESETS = [
  {
    name: 'Clay', base: '#b5aca3', ambient: .3, ground: '#5a524c',
    lights: [L(-.45, .45, 1.1, .5)], spec: .12, roughness: .55, rim: .25, rimColor: '#2a2522', rimWidth: .35,
  },
  {
    name: 'Matte White', base: '#e4e4e4', ambient: .5, ground: '#8a8a8a',
    lights: [L(-.25, .35, .9, .6)], spec: .05, roughness: .7,
  },
  {
    name: 'Graphite', base: '#3a3b3f', ambient: .3, ground: '#202022',
    lights: [L(-.35, .45, 1, .2)], spec: .45, roughness: .28, rim: .35, rimColor: '#9aa0ab', rimWidth: .3,
  },
  {
    name: 'Red Wax', base: '#a9301d', ambient: .25, ground: '#3a1a12',
    lights: [L(-.3, .4, 1.1, .6)], scatter: .7, scatterColor: '#ff5a2e', spec: .6, roughness: .2,
  },
  {
    name: 'Skin', base: '#d9a184', ambient: .35, ground: '#6a4434',
    lights: [L(-.35, .4, 1, .55)], scatter: .45, scatterColor: '#e0503a', spec: .18, roughness: .45,
  },
  {
    name: 'Jade', base: '#4f8a5e', ambient: .3, ground: '#1e3324',
    lights: [L(-.3, .45, 1, .5)], scatter: .5, scatterColor: '#9fe08a', spec: .7, roughness: .15,
    refl: .6, blur: .12,
  },
  {
    name: 'Plastic', base: '#2f6fd6', ambient: .3, ground: '#14233f',
    lights: [L(-.35, .45, 1, .25), L(.6, -.2, .35, .3)], spec: 1, roughness: .12, refl: .6, blur: .04,
  },
  {
    name: 'Car Paint', base: '#8c1410', ambient: .2, ground: '#200606',
    lights: [L(-.3, .5, 1, .2), L(.55, -.35, .35, .15)], spec: 1.2, roughness: .1, refl: 1, blur: .02,
  },
  {
    name: 'Chrome', base: '#f2f2f2', metal: 1, refl: 1, blur: .015, env: 'horizon',
    spec: 0, ambient: 0,
  },
  {
    name: 'Gold', base: '#f0b44c', metal: 1, refl: 1.1, blur: .12,
    lights: [L(-.35, .45, 1.2, .35), L(.6, .1, .6, .5)], spec: .6, roughness: .2, ambient: 0,
  },
  {
    name: 'Brushed Steel', base: '#b8bcc2', metal: 1, refl: 1, blur: .35,
    lights: [L(-.3, .5, 1, .6), L(.55, -.2, .5, .6)], spec: .4, roughness: .4, ambient: .05,
  },
  {
    name: 'Pearl', base: '#e9e4dc', ambient: .4, ground: '#9c90a0',
    lights: [L(-.3, .45, .9, .5)], spec: .5, roughness: .25, refl: .7, blur: .3, env: 'sky',
    rim: .45, rimColor: '#c8b8ff', rimWidth: .45,
  },
  {
    name: 'Toon', base: '#e8583a', ambient: .3, ground: '#4a1a10',
    lights: [L(-.35, .45, 1, .2)], toon: true, steps: 2, toonSoft: .05, spec: .8, roughness: .2,
    outline: .035, outlineColor: '#1a1a1a',
  },
  {
    name: 'Rim Light', base: '#1d1f24', ambient: .15, ground: '#0c0d10',
    lights: [L(-.3, .4, .5, .3), L(.72, .62, 1.3, .1, '#9cc8ff')], spec: .5, roughness: .3,
    rim: .7, rimColor: '#6fb1ff', rimWidth: .28,
  },
  {
    name: 'Zebra', base: '#f2f2f2', ambient: .95, sky: '#ffffff', ground: '#ffffff',
    lights: [L(-.3, .4, .15, .5)], spec: 0, stripes: 14, stripeColor: '#111111', stripeWidth: .5,
  },
  { name: 'Normal', mode: 'normal' },
];

export function fromPreset(p) {
  const s = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(p)) if (k !== 'name') s[k] = structuredClone(v);
  return s;
}
