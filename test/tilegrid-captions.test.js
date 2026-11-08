// Renders the shipped TileGrid.qml offscreen at the base-size-14 popup width
// (a 547 px grid), with the fixture displays (the laptop and one Northwind,
// with the physical sizes hyprctl reports; the live fixture predates those
// fields) at the wired monitors.lua, and reads the caption each rectangle
// ends up showing, at the font size Text settled on. A second render adds
// the second Northwind.
// The Qt offscreen platform opens no window and talks to no compositor.
// Skipped when the Qt qml runtime is not installed.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { VERSION_DIR, WIRED, laptop, northwind, tmpdir } = require("./helpers.js")

const MONITORS = [laptop(), northwind("DEMO00000742")]
const TWO = [laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")]
// Panel.qml: Style.space(500) card, popup padding 16 and a 2 px border per
// side at shell font size 14, spacing Style.space(8) (captions.test.js).
const GRID_WIDTH = 547
const SPACING = 9

const IN = "″"
const QML = ["/usr/lib/qt6/bin/qml", "/usr/bin/qml6", "/usr/bin/qml"].find((p) => fs.existsSync(p))

function render(gridWidth, spacing, monitors = MONITORS) {
  const dir = tmpdir("qml")
  const url = "file://" + VERSION_DIR
  const harness = `
import QtQuick
import "${url}" as Plugin
import "${url}/Model.js" as Model

Item {
  id: root
  width: ${gridWidth}
  height: 800
  readonly property var displays: Model.configuredDisplays(Model.parseMonitors(${JSON.stringify(JSON.stringify(monitors))}), ${JSON.stringify(WIRED)})
  readonly property var tiles: Model.catalog(displays)

  Plugin.TileGrid {
    id: grid
    width: ${gridWidth}
    height: implicitHeight
    tiles: root.tiles
    spacing: ${spacing}
    fontFamily: "monospace"
  }

  function collect(item, tileId, out) {
    if (item.modelData !== undefined && item.modelData && item.modelData.drawing !== undefined) tileId = item.modelData.id
    if (item.objectName === "screenRect") {
      var row = { tile: tileId, key: item.modelData.key, laptop: item.modelData.laptop, w: item.width, h: item.height }
      for (var j = 0; j < item.children.length; j++) {
        var c = item.children[j]
        if (c.objectName !== "caption" && c.objectName !== "overlay") continue
        row[c.objectName] = { text: c.text, px: c.fontInfo.pixelSize, family: c.fontInfo.family, truncated: c.truncated, visible: c.visible, width: c.width }
      }
      out.push(row)
    }
    for (var i = 0; i < item.children.length; i++) collect(item.children[i], tileId, out)
  }

  Timer {
    interval: 200
    running: true
    onTriggered: {
      var out = []
      root.collect(grid, "", out)
      console.log("CAPTIONS " + JSON.stringify({ tileWidth: grid.tileWidth, tileHeight: grid.tileHeight, rects: out }))
      Qt.quit()
    }
  }
}
`
  const file = path.join(dir, "harness.qml")
  fs.writeFileSync(file, harness)
  const res = spawnSync(QML, [file], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || dir, LANG: "C.UTF-8",
      QT_QPA_PLATFORM: "offscreen", QT_FORCE_STDERR_LOGGING: "1"
    },
    encoding: "utf8", timeout: 60000
  })
  const line = (res.stderr + "\n" + res.stdout).split("\n").find((l) => l.includes("CAPTIONS "))
  assert.ok(line, "harness printed its captions:\n" + res.stderr + res.stdout)
  return JSON.parse(line.slice(line.indexOf("CAPTIONS ") + 9))
}

test("TileGrid.qml at the base-size-14 popup width shows the brand at 11 px, not the serial, in every rectangle", { skip: QML ? false : "qml runtime not installed" }, () => {
  const out = render(GRID_WIDTH, SPACING)
  assert.ok(Math.abs(out.tileWidth - GRID_WIDTH / 3 + 6) < 0.01 && out.tileHeight === 123, JSON.stringify([out.tileWidth, out.tileHeight]))
  const externals = out.rects.filter((r) => !r.laptop)
  assert.equal(externals.length, 6, JSON.stringify(out.rects))
  const jetbrains = externals.every((r) => /JetBrains/.test((r.caption || r.overlay).family))
  for (const r of externals) {
    const kind = r.tile.split(":")[0]
    const shown = kind === "mirror" ? r.overlay : r.caption
    assert.ok(shown && shown.visible, `${kind}: ${JSON.stringify(r)}`)
    assert.ok(!shown.text.includes("742"), `${kind}: ${shown.text}`)
    assert.equal(shown.truncated, false, `${kind}: ${JSON.stringify(shown)}`)
    if (kind === "mirror") assert.equal(shown.text, "Northwind 15.3" + IN, kind)
    else assert.equal(shown.text, "Northwind", kind)
    if (!jetbrains) continue
    // Sizes as captions.test.js predicts from the measured widths: the brand
    // at 11 px in the arrangement tiles (not shrunk to 8 as in a narrower
    // card), at the full 14 px in the laptop-off tile, the full label
    // at 10 px on the mirror tile.
    const px = kind === "mirror" ? 10 : (kind === "off" ? 14 : 11)
    assert.equal(Math.round(shown.px), px, `${kind}: ${JSON.stringify(shown)}`)
    const size = kind === "mirror" ? [108, 67] : (kind === "off" ? [91, 50] : (kind === "above" || kind === "below" ? [66, 36] : [65, 36]))
    assert.deepEqual([r.w, r.h], size, kind)
  }
  // The laptop rectangles show their glyph, never a caption, and the mirror rectangle has no centred caption.
  for (const r of out.rects.filter((x) => x.laptop)) assert.equal([...r.caption.text].length, 1, JSON.stringify(r))
  for (const r of externals.filter((x) => x.tile.startsWith("mirror"))) assert.equal(r.caption.visible, false)
})

test("TileGrid.qml at the base-size-14 popup width, two identical Northwinds: the serial tails, whole, at the caption size", { skip: QML ? false : "qml runtime not installed" }, () => {
  const out = render(GRID_WIDTH, SPACING, TWO)
  const externals = out.rects.filter((r) => !r.laptop)
  assert.ok(externals.length >= 20, JSON.stringify(out.rects.length))
  const jetbrains = externals.every((r) => /JetBrains/.test((r.caption || r.overlay).family))
  for (const r of externals) {
    const kind = r.tile.split(":")[0]
    const shown = r.caption
    assert.ok(shown && shown.visible, `${kind}: ${JSON.stringify(r)}`)
    assert.equal(shown.text, r.key.endsWith("0742") ? "0742" : "0519", `${kind}: ${shown.text}`)
    assert.equal(shown.truncated, false, `${kind}: ${JSON.stringify(shown)}`)
    if (!jetbrains) continue
    // Three-in-a-row tiles: 43x23 rectangles, the tail at 10 px; the others 65x36, at 14 px.
    if (kind === "row") assert.deepEqual([r.w, r.h, Math.round(shown.px)], [43, 23, 10], `${kind}: ${JSON.stringify(r)}`)
    else assert.deepEqual([r.w, r.h, Math.round(shown.px)], [65, 36, 14], `${kind}: ${JSON.stringify(r)}`)
  }
})
