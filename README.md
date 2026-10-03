# Topometric

Free tools for game artists that run entirely in your browser.
Nothing is uploaded: textures are read, processed and saved on your own machine.

## Tools

| Tool | What it does |
| --- | --- |
| **Channel Packer** | Packs channels from up to four textures into one RGB/RGBA map (ORM, masks and so on). Drag wires from input channels to output channels, invert, fill unused channels with black or white, resize, and save as TGA or PNG. |

## Running locally

ES modules and Web Workers don't load from `file://`, so the site needs a static server. Any will do; one with no dependencies is included:

```bash
npm start
```

Then open <http://localhost:8080>. Without npm, `node scripts/serve.mjs` or `python -m http.server 8080` work the same way.

## Publishing on GitHub Pages

**Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.

No build step and no GitHub Actions: Pages serves the files as they are (`.nojekyll` turns off Jekyll processing).

### Why hosting costs nothing

- Pages only serves static files. All the work happens in the visitor's browser, so there is no server compute to pay for, however many people use the site.
- No Actions workflow, so no CI minutes are used on deploy.
- The site is small (tens of kilobytes) and each tool's code is loaded only when its page is opened.
- The Content Security Policy in `index.html` forbids network requests (`connect-src 'none'`), so no tool can upload user files even by mistake.

## Accuracy

- Images are decoded without premultiplied alpha and without color conversion (WebGL readback), so RGB under fully transparent pixels is preserved.
- TGA and PNG are read and written by hand-written codecs in `src/tools/channel-packer/codecs.js`, not through `<canvas>`, so saved values are exactly the packed ones.
- Downscaling averages the exact covered area of source pixels; upscaling is linear.
- Browsers decode images to 8 bits per channel; 16-bit PNGs are marked as converted.

## Project structure

```
index.html                  shell: sidebar, page container, icon sprite, CSP
favicon.svg
src/
  boot.js                   restores the sidebar state before first paint
  app.js                    sidebar, hash routing (#tool-id), lazy loading of tools
  core/                     helpers shared by all tools (DOM, toast)
  styles/base.css           design tokens and shell styles
  tools/
    registry.js             list of tools
    channel-packer/
      channel-packer.js     UI and decoding (main thread)
      channel-packer.css
      worker.js             resampling, packing, encoding (Web Worker)
      codecs.js             TGA read/write, PNG write
scripts/serve.mjs           dev server
```

Plain HTML, CSS and JavaScript modules — no framework, no bundler, no dependencies.

## Adding a tool

1. Create `src/tools/<id>/<id>.js` exporting `mount(section, { showToast })`. It fills the given `<section>` with the tool; it may return `{ show(), hide() }`.
2. Put its styles in `src/tools/<id>/<id>.css`. Prefix class names to avoid clashes and reuse the tokens from `base.css`.
3. Add an entry to `src/tools/registry.js`. If it needs a new icon, add a `<symbol id="i-…">` to the sprite in `index.html`.
4. Move heavy per-pixel work into a module worker, as `channel-packer/worker.js` does.

The tool's script and stylesheet are loaded only when its page is opened for the first time.
