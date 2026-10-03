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

More tools are on the way.

## Privacy

Your files never leave your computer. Textures are read, processed and saved by your browser. The page's Content Security Policy blocks all network requests (`connect-src 'none'`), so a tool can't upload anything even by mistake.

## Accuracy

Packing has to be exact, so Topometric avoids the shortcuts that quietly change pixel values:

- Images are decoded without premultiplied alpha or color conversion. RGB under fully transparent pixels is preserved.
- TGA and PNG files are written byte by byte, not through `<canvas>`, so saved values are exactly the packed ones.
- Downscaling averages the exact area each output pixel covers; upscaling is linear.
- Heavy work runs in a background worker, so the page stays responsive with 4K and 8K maps.

Browsers decode images at 8 bits per channel. 16-bit PNGs are converted, and the tool shows a note when that happens.

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
  core/                     helpers shared by all tools
  styles/base.css           design tokens and shell styles
  tools/
    registry.js             the list of tools
    channel-packer/
      channel-packer.js     UI and image decoding
      channel-packer.css
      worker.js             resampling, packing, encoding (Web Worker)
      codecs.js             TGA read/write, PNG write
scripts/serve.mjs           local dev server
```

Plain HTML, CSS and JavaScript modules, with no framework, bundler or dependencies. A tool's code and styles load only when its page is first opened.

### Adding a tool

1. Create `src/tools/<id>/<id>.js` that exports `mount(section, { showToast })`. It builds the tool inside the given `<section>` and may return `{ show(), hide() }`.
2. Put the styles in `src/tools/<id>/<id>.css`. Prefix class names, and use the tokens from `base.css`.
3. Add an entry to `src/tools/registry.js`. For a new icon, add a `<symbol id="i-…">` to the sprite in `index.html`.
4. Move per-pixel work into a module worker, as `channel-packer/worker.js` does.

## License

Topometric is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), with additional permissions. In short:

- ✅ Use the tools for anything, including paid and commercial work.
- ✅ The files you make with them are yours: use, publish and sell them, no credit needed.
- ✅ Read, change and share the code for noncommercial purposes, keeping the license and copyright notice.
- ❌ Don't sell Topometric or its code, or run it as a paid, subscription or ad-supported service, without written permission.

This summary is for convenience only; [LICENSE.md](LICENSE.md) is the binding text. For commercial licensing, contact the author on [GitHub](https://github.com/ilumetric).

## Contributing

Bug reports and ideas for new tools are welcome in [Issues](https://github.com/ilumetric/Topometric/issues). By submitting a contribution, you agree that it may be distributed under this project's license, and under any future license the author chooses for Topometric.
