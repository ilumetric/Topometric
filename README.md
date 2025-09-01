# Topometric

Houdini toolkit in the style of SideFX Labs.

## Install via Houdini Packages

1. Clone this repo, e.g. to `D:/Houdini/Topometric`.
2. Create a package file in your user packages folder:
   - Windows: `C:/Users/<User>/Documents/houdini20.5/packages/topometric.json`
   - Linux: `~/houdini20.5/packages/topometric.json`
   - macOS: `~/Library/Preferences/houdini/20.5/packages/topometric.json`
3. Put this JSON into the file:

```json
{
  "enable": true,
  "env": [
    { "TOPOMETRIC_ROOT": "D:/Houdini/Topometric" },
    { "HOUDINI_PATH": "$HOUDINI_PATH;$TOPOMETRIC_ROOT;&" },
    { "HOUDINI_OTLSCAN_PATH": "$TOPOMETRIC_ROOT/otls;$HOUDINI_OTLSCAN_PATH" },
    { "PYTHONPATH": "$TOPOMETRIC_ROOT/python;$PYTHONPATH" }
  ]
}
```

Adjust `TOPOMETRIC_ROOT` to your clone path.

## Repo structure

- `otls/` — HDAs (`.hda`/`.otl`)
- `toolbar/` — shelves and tools (`.shelf`)
- `python/` — Python package `topometric`
- `help/` — help pages (HTML/MD)
- `docs/` — documentation
- `examples/` — HIP scenes and test assets
- `icons/` — icons for tools/nodes
- `config/` — extra config files
- `packages/` — Houdini package files

## Contributing

PRs welcome. Keep HDAs versioned and prefer unlocked development assets.
