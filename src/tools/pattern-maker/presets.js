// Starting points. Each preset is a full pattern: global settings and a layer stack.
// Layers only list what differs from their type's defaults (see newLayer in pattern.js).
import { newLayer } from './pattern.js';

export const GLOBAL = { seed: 1, size: 2048, bg: .42, black: 0, white: 1, invert: false, grain: 0 };

export const PRESETS = [
  {
    name: 'Shards',
    g: { seed: 7, bg: .44 },
    layers: [
      ['strokes', { count: 50, sizeMin: .12, sizeMax: .3, stretch: 3, bend: .2, taper: .2, round: .3, toneMin: .34, toneMax: .5 }],
      ['shards', { count: 150, sizeMin: .06, sizeMax: .3, bias: -.3, sides: 4, irregular: .7, stretch: 2.5, gradients: .1, toneMin: .3, toneMax: .52 }],
      ['halftone', { count: 9, sizeMin: .14, sizeMax: .26, dotSpacing: .011, dotSize: .7, toneMin: .55, toneMax: .66 }],
      ['lines', { count: 9, sizeMin: .14, sizeMax: .3, lines: 7, lineGap: .012, lineFill: .45, ragged: .5, angle: 45, jitter: .04, toneMin: .55, toneMax: .72 }],
      ['shards', { count: 240, sizeMin: .015, sizeMax: .08, bias: -.5, sides: 3, irregular: .8, stretch: 4, gradients: .5, toneMin: .15, toneMax: .95 }],
    ],
  },
  {
    name: 'Bars',
    g: { seed: 3, bg: .22 },
    layers: [
      ['strokes', { count: 110, spread: 'columns', sizeMin: .18, sizeMax: .42, stretch: 3.2, bend: 0, taper: .08, round: .55, wobble: 0, streaks: .35, angle: 90, jitter: .015, largeFirst: true, toneMin: .14, toneMax: .82, gradients: .35, gradMode: 'across', gradDir: 'random', gradAmount: -.2, gradBoth: true }],
      ['strokes', { count: 70, spread: 'columns', sizeMin: .06, sizeMax: .14, stretch: 1.8, bend: 0, taper: 0, round: .8, wobble: 0, angle: 90, jitter: .015, toneMin: .1, toneMax: .6 }],
      ['shards', { count: 150, sizeMin: .015, sizeMax: .05, bias: -.4, sides: 4, irregular: 0, stretch: 3.5, gradients: 0, angle: 0, jitter: 0, toneMin: .15, toneMax: .95 }],
    ],
  },
  {
    name: 'Bubbles',
    g: { seed: 11, bg: .46 },
    layers: [
      ['circles', { count: 70, sizeMin: .08, sizeMax: .32, bias: -.4, stretch: 1.04, toneMin: .38, toneMax: .82, gradients: .3, gradMode: 'radial', gradAmount: -.18 }],
      ['halftone', { count: 14, sizeMin: .1, sizeMax: .24, dotSpacing: .011, dotSize: .78, toneMin: .6, toneMax: .8 }],
      ['circles', { count: 36, sizeMin: .05, sizeMax: .16, stretch: 1.1, satellites: 7, satSize: .2, satContrast: -.4, toneMin: .4, toneMax: .78 }],
      ['circles', { count: 240, sizeMin: .008, sizeMax: .035, bias: -.5, stretch: 1.25, toneMin: .12, toneMax: .9 }],
    ],
  },
  {
    name: 'Grass',
    g: { seed: 9, bg: .1 },
    layers: [
      ['strokes', { count: 360, sizeMin: .1, sizeMax: .22, stretch: 9, bend: .35, taper: 1, round: .4, wobble: .1, tips: 'aligned', angle: 90, jitter: .14, toneMin: .08, toneMax: .2, gradients: 1, gradMode: 'along', gradDir: 'fixed', gradAmount: .75 }],
      ['strokes', { count: 260, sizeMin: .06, sizeMax: .14, stretch: 8, bend: .3, taper: 1, round: .4, wobble: .1, tips: 'aligned', angle: 90, jitter: .2, toneMin: .15, toneMax: .3, gradients: 1, gradMode: 'along', gradDir: 'fixed', gradAmount: .65 }],
    ],
  },
  {
    name: 'Bricks',
    g: { seed: 4, bg: .78 },
    layers: [
      ['strokes', { spread: 'bricks', brickRows: 12, brickCols: 4, brickGap: .01, brickOffset: .5, bend: 0, taper: 0, round: .12, wobble: .15, tips: 'random', jitter: .2, toneMin: .25, toneMax: .55, gradients: .6, gradMode: 'across', gradDir: 'random', gradAmount: -.12 }],
      ['shards', { count: 320, sizeMin: .004, sizeMax: .02, bias: -.5, sides: 5, irregular: .8, stretch: 1.5, gradients: 0, toneMin: .1, toneMax: .3, opacity: .55, blend: 'darken' }],
    ],
  },
  {
    name: 'Planks',
    g: { seed: 12, bg: .08 },
    layers: [
      ['strokes', { spread: 'bricks', brickRows: 6, brickCols: 2, brickGap: .004, brickOffset: 0, brickRandom: 1, brickVary: .6, bend: 0, taper: 0, round: .04, wobble: .04, streaks: .25, tips: 'random', jitter: 0, toneMin: .35, toneMax: .62 }],
      ['wood', { rings: 42, warp: .4, warpScale: 3, detail: .4, sharpness: .6, fibers: .45, knots: 3, knotSize: .03, toneMin: .2, toneMax: .75, opacity: .85, blend: 'overlay' }],
    ],
  },
  {
    name: 'Wood',
    g: { seed: 21, bg: .4 },
    layers: [
      ['wood', { rings: 16, warp: .45, warpScale: 2, detail: .4, sharpness: .6, fibers: .4, knots: 2, knotSize: .06, toneMin: .2, toneMax: .66 }],
    ],
  },
  {
    name: 'Brush',
    g: { seed: 5, bg: .4 },
    layers: [
      ['strokes', { tips: 'random', gradDir: 'random', count: 40, sizeMin: .14, sizeMax: .3, stretch: 2.6, bend: .3, taper: .3, round: .5, wobble: .3, toneMin: .16, toneMax: .3 }],
      ['strokes', { tips: 'random', gradDir: 'random', count: 230, sizeMin: .05, sizeMax: .17, stretch: 3, bend: .25, taper: .45, round: .55, wobble: .3, angle: 30, toneMin: .3, toneMax: .72 }],
      ['lines', { count: 4, sizeMin: .3, sizeMax: .5, lineMode: 'arc', lines: 10, lineGap: .01, lineFill: .4, arcSpan: 70, ragged: .3, toneMin: .44, toneMax: .62, gradients: 1, gradAmount: -.25 }],
      ['lines', { count: 5, sizeMin: .22, sizeMax: .4, lines: 6, lineGap: .013, lineFill: .35, ragged: .4, angle: 50, toneMin: .5, toneMax: .62 }],
    ],
  },
];

export function fromPreset(pr) {
  return {
    g: { ...GLOBAL, ...pr.g },
    layers: pr.layers.map(([type, over], i) => newLayer(type, { seed: 101 + i * 37, ...over })),
  };
}
