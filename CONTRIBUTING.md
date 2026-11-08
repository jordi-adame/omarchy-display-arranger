# Contributing

## Layout

- `manifest.json`: the Omarchy plugin manifest; `entryPoints.barWidget` names the version folder the shell loads.
- `v3/`: `Panel.qml` (bar icon, popup, keys), `TileGrid.qml` (the tiles), `Model.js` (catalog, positions, the `monitors.lua` reader, the Lua text), `apply.sh` (applies a click; wires `monitors.lua` when the popup's notice is answered Yes; dry run), `i18n/en.json` (strings).
- `test/`: `node --test` suites, the stub Lua runner, made-up fixtures.
- `tools/`: `render-preview.js` (screenshots) and `measure-font-widths.js` (the font fixture), Qt offscreen only.

## Tests

```bash
mkdir -p .scratch
TMPDIR=$PWD/.scratch node --test                          # 202 tests
omarchy plugin validate .
/usr/lib/qt6/bin/qmllint v3/TileGrid.qml v3/Panel.qml     # qs.* import warnings are expected
bash -n v3/apply.sh
```

Needs `lua`, `luac` and the Qt `qml` runtime (`qt6-declarative`). Every command
`apply.sh` runs is stubbed and `HYPRLAND_INSTANCE_SIGNATURE` is unset, so
nothing reaches the live session. Screenshots:
`TMPDIR=$PWD/.scratch node tools/render-preview.js <one|two|mirror> screenshots/<name>.png`.

## A QML change goes in a new version folder

The shell loads a changed bar widget only from a fresh subdirectory. A release
that changes anything under `v3/` copies it to `v4/`, edits there, points
`entryPoints.barWidget` at `v4/Panel.qml`, bumps `version` and deletes `v3/`,
all in one commit. The tests and tools follow the manifest.

Translations: another file in `v3/i18n/`, named by locale; `%1` to `%3` are the display names.
