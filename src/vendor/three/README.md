# three.js (vendored)

[three.js](https://threejs.org) r186 (npm `three@0.186.1`), MIT license (see `LICENSE`).

Files are copied from the npm package and minified one by one with esbuild, without bundling,
so imports stay as they are. Pages map the bare `three` specifier and the `three/addons/` prefix
to this folder through the import map in `index.html`.

| Here | From the npm package |
| --- | --- |
| `three.core.js`, `three.module.js` | `build/` |
| `addons/…` | `examples/jsm/…` (only the files we use) |

## Updating or adding an addon

```bash
npm pack three@<version>
tar xzf three-<version>.tgz
cd package
npx esbuild build/three.core.js --minify --format=esm --outfile=<repo>/src/vendor/three/three.core.js
npx esbuild build/three.module.js --minify --format=esm --outfile=<repo>/src/vendor/three/three.module.js
npx esbuild examples/jsm/<path>.js --minify --format=esm --outfile=<repo>/src/vendor/three/addons/<path>.js
```

When adding an addon, also copy every file it imports with a relative path.
