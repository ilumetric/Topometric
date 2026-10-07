// sRGB → linear for saved files.
//
// Values in Topometric are what you see: they're shown as sRGB. A game engine that imports a
// texture with sRGB off (Unreal: sRGB unchecked, Grayscale or Masks compression) reads the
// same bytes as linear, so mid grays come out lighter and the texture looks washed out.
// Saving with "Linear" converts the values first, so the texture looks the same in the
// engine as in the tool. At 8 bits the darkest tones get fewer steps; that's the trade-off
// of storing linear values.

export const SPACES = [
  ['srgb', 'sRGB', 'Values as you see them, for textures imported with sRGB on'],
  ['linear', 'Linear', 'For textures imported with sRGB off (Unreal: sRGB unchecked, Grayscale or Masks): values are converted so the texture looks the same in the engine as here'],
];

const LUT = new Uint8Array(256);
for (let v = 0; v < 256; v++) {
  const c = v / 255;
  LUT[v] = Math.round(255 * (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
}

// Converts pixels in place: `ch` bytes per pixel; a 4th channel (alpha) is left as it is.
export function toLinear(px, ch) {
  const n = ch === 4 ? 3 : ch;
  for (let i = 0; i < px.length; i += ch) for (let k = 0; k < n; k++) px[i + k] = LUT[px[i + k]];
  return px;
}
