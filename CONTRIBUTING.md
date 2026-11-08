# Contributing

## Layout

| Path | What it is |
|---|---|
| `manifest.json` | The Omarchy plugin manifest. `entryPoints.barWidget` names the version folder the shell loads. |
| `v1/` | The widget: `Panel.qml` (bar icon, popup, keyboard cursor, the calls to `apply.sh`), `TileGrid.qml` (the tiles), `Model.js` (catalog, position maths, the `monitors.lua` reader, the Lua text), `apply.sh` (applies one click, wires `monitors.lua`, holds the dry run), `i18n/en.json` (the strings). |
| `test/` | `node --test` suites, the stub Lua runner and made-up fixtures. |
| `tools/` | `render-preview.js` (the README screenshots) and `measure-font-widths.js` (the font fixture), both with the Qt offscreen platform. |
| `screenshots/` | Rendered by `tools/render-preview.js`. |

## A change to the QML goes in a new version folder

The Omarchy shell caches a bar widget by its file path and loads a changed
widget only from a fresh subdirectory; editing `v1/Panel.qml` in place leaves
the running shell on the old copy until it is restarted. So a release that
changes anything under the version folder:

1. copies `v1/` to `v2/` and makes the change there;
2. points `entryPoints.barWidget` in `manifest.json` at `v2/Panel.qml` and bumps `version`;
3. deletes `v1/`;

all in the same commit, so the manifest never names a folder that is not there.
The tests and the preview tool follow the manifest, so nothing else moves.

## Tests

```bash
mkdir -p .scratch
TMPDIR=$PWD/.scratch node --test        # 174 tests
omarchy plugin validate .               # prints nothing, exit 0
/usr/lib/qt6/bin/qmllint v1/TileGrid.qml v1/Panel.qml   # warnings about qs.* imports are expected
bash -n v1/apply.sh
```

The tests make their temp files under `TMPDIR` (gitignored `.scratch/` keeps
them out of `/tmp`). They need `lua` and `luac` (the `lua` package, a
dependency of `hyprland`); `test/tilegrid-captions.test.js` and the tools need
the Qt `qml` runtime (`qt6-declarative`, which Omarchy ships) and run with
`QT_QPA_PLATFORM=offscreen`: no window, no compositor. Every command `apply.sh`
runs is stubbed and `HYPRLAND_INSTANCE_SIGNATURE` is unset, so nothing reaches
the live session.

To try a change in the bar without it touching anything, put an empty file
named `DRY_RUN` next to `apply.sh` in the installed copy: clicks are then only
logged to `~/.local/state/display-arranger/apply.log` and the popup says
"Dry run: nothing applied".

## Screenshots

```bash
TMPDIR=$PWD/.scratch node tools/render-preview.js one screenshots/one-external.png
TMPDIR=$PWD/.scratch node tools/render-preview.js two screenshots/two-externals.png
TMPDIR=$PWD/.scratch node tools/render-preview.js mirror screenshots/mirror.png
```

## Translations

The strings live in `v1/i18n/en.json` (Omarchy `Translations` keys). A
translation is another file in that folder, named by locale; `%1`, `%2` and
`%3` are the display names.
