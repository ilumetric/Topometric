// Image decoding shared by tools: RGBA bytes exactly as stored in the file, top row first.
// No premultiplied alpha and no color conversion, so RGB under transparent pixels survives.
import { parseTGA } from './codecs.js';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.tga,.webp,.bmp,image/*';
export const isImageFile = f => /^image\//.test(f.type) || /\.tga$/i.test(f.name);

let gl;
// WebGL returns pixels without premultiplication, so RGB under zero alpha survives intact.
function readPixels(bitmap) {
  if (!gl || gl.isContextLost()) gl = document.createElement('canvas').getContext('webgl', { premultipliedAlpha: false });
  if (!gl) return null;
  const { width: w, height: h } = bitmap;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (w > max || h > max) return null;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let data = null;
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
    data = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return data;
}

// Returns { w, h, data, note }; `note` tells about anything lost while decoding.
export async function decodeImage(file) {
  if (/\.tga$/i.test(file.name)) return parseTGA(await file.arrayBuffer());
  // Browsers decode images to 8 bits per channel only.
  const head = new Uint8Array(await file.slice(0, 26).arrayBuffer());
  const is16 = head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47 && head[24] === 16;
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  let data = readPixels(bitmap), note = is16 ? '16-bit → 8-bit' : '';
  if (!data) {
    // Too big for WebGL: a 2D canvas stores premultiplied color.
    note = 'Color under transparency may change';
    const c = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    data = ctx.getImageData(0, 0, c.width, c.height).data;
  }
  const { width: w, height: h } = bitmap;
  bitmap.close();
  return { w, h, data, note };
}
