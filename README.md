<p align="center">
  <img src="favicon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Topometric</h1>

<p align="center">
  Free browser tools for game artists.<br>
  Everything runs on your computer: no uploads, no accounts, no installs.
</p>

<p align="center">
  <a href="https://ilumetric.github.io/Topometric/"><b>Open Topometric</b></a>
</p>

---

## Tools

### Channel Packer

Packs channels from up to four textures into one map: ORM, masks, terrain splat maps and the like.

- Drag wires from any input channel (R, G, B, A) to any output channel.
- Invert any channel. Fill unconnected channels with black or white.
- Write alpha only when you need it; without it the file is saved as RGB.
- Output size: auto (largest input), the size of any input, or a custom power of two up to 8192.
- Save the full map, or a single channel as grayscale.
- Load PNG, JPG, TGA, WebP and BMP; save TGA (RLE) or PNG.
- Drop a file on a texture card to replace it while keeping its wires.
- Open the packed map in Kuwahator with one click to paint it with brush strokes.

### MatCap Generator

Builds matcaps — the shaded spheres Blender, ZBrush and many engines use as quick materials.

- 18 presets to start from: clay, ORB Clay and ORB Clay Gloss (the popular ZBrush matcaps, recreated), wax, skin, jade, plastic, car paint, chrome, gold, toon, zebra, normal and more.
- Up to four lights, placed by dragging them on the sphere — or over the 3D preview, in the same 2D layout: each one puts its highlight right where you drop it.
- Material with sky/ground ambient and subsurface-like scatter, specular, reflections (studio, sky or horizon environment, blur, metallic), rim light, a thin edge light and an edge shadow that sets the sphere off the background.
- Stylize: toon steps, outline, stripes. Adjust: exposure, contrast, saturation, grain.
- Live 3D preview on a knot, torus, blob, the Stanford Bunny or Blender's Suzanne — or drop your own model (GLB, GLTF, OBJ, FBX, STL).
- Save PNG at 256–2048 px (512 by default). Background: *Extend* (default), which stretches the edge colors outward so texture filtering never picks up a foreign color, a solid color, or transparent. Undo with Ctrl+Z.

### Kuwahator

Turns a texture into painted strokes with an anisotropic Kuwahara filter, the same kind of filter as Substance Designer's.

- Radius, Smoothness, Sharpness and Anisotropy. Strokes follow the shapes of the image and edges stay crisp.
- Color mode filters the image as a whole. Per channel mode treats each channel as its own grayscale mask with its own settings, and any channel can be left untouched — for packed maps.
- A viewer made for checking detail: zoom to the cursor up to 6400 %, pan, fit or 1:1, a pixel grid when zoomed in, a before/after split and single-channel views. Keys: F fit, 1 actual pixels, C compare.
- Seamless: filters across the edges, so a tileable texture stays tileable; Tiled shows it repeated.
- Runs on the GPU in tiles, starting where you look, so 4K and 8K maps stay responsive.
- Load PNG, JPG, TGA, WebP and BMP; save TGA (RLE) or PNG. Alpha is kept when the source has it.

### Tile Maker

Makes an ordinary texture or photo tile seamlessly — without the visible seams and the grid of bright and dark patches that give a repeat away.

- Smart cut: the edges overlap, and they are joined along the path where both sides match best (image quilting's minimum error cut), so there's no ghosting and detail stays sharp. The top/bottom path closes around the tile, so the corners meet too. Crossfade is there for soft textures like clouds or fog.
- Heal seams: the strip around each seam is painted again from similar spots of the texture (PatchMatch, like content-aware fill), so a cut through a stone or a leaf becomes a natural edge.
- Equalize: evens out light and color that change across a photo (vignetting, light falloff) before the seams are made.
- Clone brush: Alt+click picks a source, then paint over anything that still gives the repeat away. Strokes wrap around the tile edges and stay when you change the settings.
- Tiled viewer: the result repeats in every direction, the fitted view puts the point where four tiles meet in the middle, Edges outlines the tiles, and Compare shows the source tiled as is next to the result.
- Size: native (the source minus the overlap) or 512–8192 px; resizing wraps around the edges, so the tile stays seamless.
- Open the result in Kuwahator with one click; it arrives with Seamless on, so it stays tileable.
- Load PNG, JPG, TGA, WebP and BMP; save TGA (RLE) or PNG. Alpha is kept when the source has it.

### Pattern Maker

Generates stylized grayscale patterns that always tile — the abstract shape mixes used as masks and breakup for hand-painted and stylized materials.

- Build the pattern from layers: Shards (angular polygons, chips, rectangles), Strokes (brush strokes and bars with bend, taper, round ends, wobble and bristle streaks), Circles (with spots inside), Halftone (dot patches that fade towards a rough edge) and Lines (straight hatching or concentric arcs).
- Every layer has its own count, spread (random, grid, columns, rows), size range and bias, angle and jitter, tone range, opacity and blend mode (normal, lighten, darken, overlay), and its own seed.
- Gradient fills laid out by each shape: along or across strokes and bars, radial or from an off-centre highlight on circles, along the lines and arcs of a bundle (arcs fade around the curve), linear or radial on shards and halftone patches. Choose the share of shapes that get one and how much lighter or darker the end goes. Hide, duplicate or delete layers, and drag them to reorder (or Alt+↑ / Alt+↓).
- Four presets to start from: Shards, Bars, Bubbles and Brush. One seed reshuffles the whole pattern (R).
- Levels, grain and invert for the final mask. Undo with Ctrl+Z.
- Sizes are a share of the texture, so the pattern looks the same at 512 and at 4096 px. Shapes that cross an edge continue on the opposite side, so the texture is seamless by construction; the tiled viewer shows it repeated.
- Save a grayscale TGA (RLE) or PNG at 512–4096 px, or open it in Kuwahator with Seamless on.

More tools are on the way.

## Presets

MatCap Generator, Kuwahator, Tile Maker and Pattern Maker share one preset system:

- Each tool's built-in presets and your own sit in the same list. **Save** stores the current settings under a name; saving under an existing name updates that preset. Double-click a saved preset to rename it.
- A preset holds only settings, never images, so it's a few kilobytes.
- Saved presets live in your browser. Download one preset, or all of them at once, as a `.json` file to keep a copy or share it. **Import** (or drop a file on the list) adds them back. A file knows which tool it's for, so importing it from any tool's page adds it to the right list.

## Privacy

Your files never leave your computer. Textures are read, processed and saved by your browser. The page's Content Security Policy only lets scripts read the site's own files and local `blob:`/`data:` URLs (`connect-src 'self' blob: data:`), so a tool can't upload anything even by mistake.

## Accuracy

Packing has to be exact, so Topometric avoids the shortcuts that quietly change pixel values:

- Images are decoded without premultiplied alpha or color conversion. RGB under fully transparent pixels is preserved.
- TGA and PNG files are written byte by byte, not through `<canvas>`, so saved values are exactly the packed ones.
- Downscaling averages the exact area each output pixel covers; upscaling is linear.
- Heavy work runs in a background worker, so the page stays responsive with 4K and 8K maps.

Browsers decode images at 8 bits per channel. 16-bit PNGs are converted, and the tool shows a note when that happens.

Matcaps are shaded on the GPU in linear space with 4 samples per pixel; the sphere edge is antialiased from its exact coverage. The preview, the thumbnails and the saved file come from the same shader, and the file is read back from an 8-bit target without any color conversion.

## Running locally

ES modules and Web Workers don't load from `file://`, so the site needs a local web server. One is included and has no dependencies; it needs [Node.js](https://nodejs.org):

```bash
npm start
```

Open <http://localhost:8080>. You can also run `node scripts/serve.mjs`, or use any static server, for example `python -m http.server 8080`.

## Deploying to GitHub Pages

In the repository, open **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`.

There is no build step and no GitHub Actions workflow. Pages serves the files as they are (`.nojekyll` turns off Jekyll). All processing happens in visitors' browsers, so hosting stays free however many people use the site.

## Project structure

```
index.html                  shell: sidebar, page container, icon sprite, CSP
src/
  app.js                    sidebar, routing (#tool-id), loading tools on demand
  boot.js                   restores the sidebar state before first paint
  core/
    dom.js, toast.js        small helpers
    controls.js             slider, color, segmented and switch controls
    presets.js              preset card shared by the tools: built-in and saved presets, JSON import/export
    color-picker.js         color wheel + HSL strips popover used by every color field
    codecs.js               TGA read/write, PNG write
    three/
      viewer.js             three.js viewer: orbit camera, fit to object, on-demand rendering
      load-model.js         GLB/GLTF, OBJ, FBX, STL from local files
  vendor/three/             three.js r186 (minified, MIT), mapped as `three` in index.html
  assets/models/            sample models (Stanford Bunny, Suzanne)
  styles/base.css           design tokens, shell and control styles
  tools/
    registry.js             the list of tools
    channel-packer/
      channel-packer.js     UI and image decoding
      channel-packer.css
      worker.js             resampling, packing, encoding (Web Worker)
    matcap/
      matcap.js             UI, light handles, undo, export
      matcap.css
      renderer.js           matcap shader (three.js RawShaderMaterial), export readback
      meshes.js             preview shapes
      presets.js            defaults and presets
    pattern-maker/
      pattern-maker.js      UI: presets, layer list, layer settings, undo, export
      pattern-maker.css
      pattern.js            layer types and the tileable renderer (2D canvas)
      presets.js            presets
      worker.js             drawing on an OffscreenCanvas, levels, encoding (Web Worker)
scripts/
  serve.mjs                 local dev server
  ply-to-glb.mjs            converts ASCII PLY to a compact GLB
  strip-glb.mjs             removes unused vertex attributes (colors, UVs) from a GLB
```

Plain HTML, CSS and JavaScript modules, with no framework, bundler or package dependencies. A tool's code and styles load only when its page is first opened. Tools that need 3D import three.js with `import * as THREE from 'three'` and addons from `three/addons/…`; it's served from `src/vendor/three`, never from a CDN.

### Adding a tool

1. Create `src/tools/<id>/<id>.js` that exports `mount(section, { showToast })`. It builds the tool inside the given `<section>` and may return `{ show(), hide() }`.
2. Put the styles in `src/tools/<id>/<id>.css`. Prefix class names, use the tokens from `base.css`, and build settings from `core/controls.js`.
3. Add an entry to `src/tools/registry.js`. For a new icon, add a `<symbol id="i-…">` to the sprite in `index.html`.
4. Move per-pixel work into a module worker, as `channel-packer/worker.js` does.
5. For presets, add a card made by `presetPicker` from `core/presets.js`: give it the built-in presets, a getter for the current settings, `normalize` (merge with defaults, usually `mergeKnown`) and `apply`, and call `sync()` after every change.
6. For 3D, reuse `core/three/viewer.js` and `core/three/load-model.js`. A three.js addon that isn't vendored yet goes into `src/vendor/three/addons/` (see the README there). If you change the import map in `index.html`, update its `sha256` hash in the Content Security Policy.

## License

Topometric is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), with additional permissions. In short:

- ✅ Use the tools for anything, including paid and commercial work.
- ✅ The files you make with them are yours: use, publish and sell them, no credit needed.
- ✅ Read, change and share the code for noncommercial purposes, keeping the license and copyright notice.
- ❌ Don't sell Topometric or its code, or run it as a paid, subscription or ad-supported service, without written permission.

This summary is for convenience only; [LICENSE.md](LICENSE.md) is the binding text. For commercial licensing, contact the author on [GitHub](https://github.com/ilumetric).

## Third-party

- [three.js](https://threejs.org) — MIT license, see `src/vendor/three/LICENSE`.
- Stanford Bunny — [Stanford 3D Scanning Repository](https://graphics.stanford.edu/data/3Dscanrep/), Stanford University Computer Graphics Laboratory.
- Suzanne — the monkey head from [Blender](https://www.blender.org), Blender Foundation.

## Contributing

Bug reports and ideas for new tools are welcome in [Issues](https://github.com/ilumetric/Topometric/issues). By submitting a contribution, you agree that it may be distributed under this project's license, and under any future license the author chooses for Topometric.
