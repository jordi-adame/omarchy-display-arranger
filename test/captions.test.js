// Rectangle captions: the forms a tile rectangle may show, the fit order
// TileGrid.qml follows, and what each rectangle shows at the sizes TileGrid
// really draws, measured in the bar font. A unique display never shows its
// serial tail. The card is wide enough for the brand to show at 11 px or
// more in every one-external tile at shell base-size 14.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { Model, laptop, northwind, displays, configured, WIRED } = require("./helpers.js")

const IN = "″"
const FONT = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "font-widths.json"), "utf8"))

// advanceWidth in the bar font (monospace resolves to JetBrainsMono Nerd Font
// Bold, Omarchy's default): the measured value when the fixture has it, else the
// monospace rule those measurements follow (0.6 em per character, truncated
// to 1/64 px).
function measure(text, px) {
  const row = FONT.advanceWidth[String(px)]
  if (row && row[text] !== undefined) return row[text]
  return [...text].length * Math.floor(0.6 * px * 64) / 64
}

// Popup geometry (Panel.qml, Omarchy's KeyboardPanel and Style): the card is
// Style.space(500) wide and the content sits
// inside popup-padding (14) and a 2 px border on each side; TileGrid gets
// that width, 3 columns, spacing Style.space(8). Style scales by
// base-size / 12; the tests cover base-size 14 and the default 12.
const CARD = 500
function gridFor(baseSize, card = CARD) {
  const space = (px) => Math.max(1, Math.round(px * baseSize / 12))
  return { width: space(card) - 2 * (space(14) + Math.max(1, space(2))), spacing: space(8) }
}

// The rectangles TileGrid.qml draws for a tile: tile width from the grid,
// 12 % pad, the picture fitted inside, 2 px gaps; with the caption size,
// the overlay size and the room (width minus 4) each rectangle gives its text.
function tileRects(tile, grid) {
  const columns = 3
  const tileWidth = Math.max(0, (grid.width - grid.spacing * (columns - 1)) / columns)
  const tileHeight = Math.round(tileWidth * 0.7)
  const pad = Math.round(tileWidth * 0.12)
  const p = tile.drawing
  const fit = Math.min((tileWidth - 2 * pad) / p.w, (tileHeight - 2 * pad) / p.h)
  return p.rects.map((r) => {
    const w = Math.max(2, Math.round(r.w * fit) - 2)
    const h = Math.max(2, Math.round(r.h * fit) - 2)
    return {
      key: r.key, laptop: r.laptop, mirror: r.mirror, off: r.off, captions: r.captions, w, h,
      captionSize: Math.max(7, Math.min(14, Math.round(h * 0.42))),
      overlaySize: Math.max(6, Math.min(10, Math.round(h * 0.18))),
      room: Math.max(0, w - 4)
    }
  })
}

const captionOf = (r) => Model.fitCaption(r.captions, r.room, r.captionSize, Model.CAPTION_MIN_PX, measure)
const overlayOf = (r) => Model.fitCaption(r.captions, r.room, r.overlaySize, Model.OVERLAY_MIN_PX, measure)
const external = (rects) => rects.find((r) => !r.laptop)
const kindOf = (tile) => tile.id.split(":")[0]

const BASE14 = gridFor(14)
// A narrower Style.space(400) card (a 431 px grid): the tight layout the fallback is kept for.
const TIGHT = gridFor(14, 400)
const SCALE_125 = WIRED.replace(/local omarchy_monitor_scale = 1\b/, "local omarchy_monitor_scale = 1.25")
assert.notEqual(SCALE_125, WIRED)
const oneExternal = (lua = WIRED) => Model.catalog(configured([laptop(), northwind("DEMO00000742")], lua))
const twoExternals = (lua = WIRED) => Model.catalog(configured([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")], lua))

test("font fixture: the measured widths follow the monospace rule the tests use for other strings", () => {
  assert.equal(FONT.family, "JetBrainsMono Nerd Font")
  for (const [px, row] of Object.entries(FONT.advanceWidth))
    for (const [text, width] of Object.entries(row))
      assert.ok(Math.abs(width - [...text].length * Math.floor(0.6 * Number(px) * 64) / 64) < 1e-9, `${text} at ${px}px: ${width}`)
})

test("captions: a unique external offers the label, the compact label and the brand", () => {
  const d = displays([laptop(), northwind("DEMO00000742")])
  assert.deepEqual(d[1].captions, ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"])
  assert.deepEqual(d[0].captions, ["Laptop"])
})

test("captions: the compact size is whole inches", () => {
  const d24 = displays([laptop(), northwind("DEMO00000519", { description: "Northwind Corporation NW-2400 ABC", model: "NW-2400", physicalWidth: 530, physicalHeight: 300 })])
  assert.deepEqual(d24[1].captions, ["Northwind 24.0" + IN, "Northwind 24" + IN, "Northwind"])
  const d16 = displays([laptop(), northwind("DEMO00000742", { physicalWidth: 345, physicalHeight: 194 })])
  assert.equal(Model.diagonalInches(345, 194), 15.6)
  assert.deepEqual(d16[1].captions, ["Northwind 15.6" + IN, "Northwind 16" + IN, "Northwind"])
})

test("captions: two identical externals offer the tail forms, brand plus tail, then the tail", () => {
  const d = displays([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")])
  const byName = Object.fromEntries(d.map((x) => [x.name, x]))
  assert.deepEqual(byName["DP-1"].captions, ["Northwind 15.3" + IN + " (0742)", "Northwind 15" + IN + " (0742)", "Northwind 0742", "0742"])
  assert.deepEqual(byName["DP-2"].captions, ["Northwind 15.3" + IN + " (0519)", "Northwind 15" + IN + " (0519)", "Northwind 0519", "0519"])
})

test("captions: duplicates without serials offer the letter forms", () => {
  const a = { name: "DP-2", description: "Acme Monitor", make: "Acme Corp.", model: "M27", serial: "", physicalWidth: 600, physicalHeight: 340, width: 2560, height: 1440, refreshRate: 60, scale: 1 }
  const d = displays([laptop(), a, Object.assign({}, a, { name: "DP-1" })])
  const byName = Object.fromEntries(d.map((x) => [x.name, x]))
  assert.deepEqual(byName["DP-2"].captions, ["Acme 27.2" + IN + " A", "Acme 27" + IN + " A", "Acme A", "A"])
  assert.deepEqual(byName["DP-1"].captions, ["Acme 27.2" + IN + " B", "Acme 27" + IN + " B", "Acme B", "B"])
})

test("captions: without a size, brand and model then the brand; without a brand, the model; else the connector", () => {
  assert.deepEqual(displays([laptop(), northwind("DEMO00000742", { physicalWidth: 0, physicalHeight: 0 })])[1].captions, ["Northwind NW-1560", "Northwind"])
  assert.deepEqual(displays([laptop(), northwind("DEMO00000742", { make: "" })])[1].captions, ["NW-1560 15.3" + IN, "NW-1560 15" + IN, "NW-1560"])
  assert.deepEqual(displays([laptop(), northwind("DEMO00000742", { make: "", model: "", physicalWidth: 0, physicalHeight: 0 })])[1].captions, ["DP-1"])
  assert.deepEqual(displays([laptop(), northwind("DEMO00000742", { model: "", physicalWidth: 0, physicalHeight: 0 })])[1].captions, ["Northwind"])
})

test("captions: labelsFor carries them, and every drawing rectangle gets its display's list", () => {
  const out = Model.labelsFor([laptop(), northwind("DEMO00000742")].map((m, i) => Object.assign({ isLaptop: i === 0 }, m)))
  assert.deepEqual(out.map((o) => o.captions), [["Laptop"], ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"]])
  for (const tile of oneExternal())
    for (const r of tile.drawing.rects)
      assert.deepEqual(r.captions, r.laptop ? ["Laptop"] : ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"], tile.id)
})

// A fake font: 0.6 em per character, no hinting.
const plain = (text, px) => [...text].length * 0.6 * px

test("fitCaption: the first form that fits at the caption size wins", () => {
  const forms = ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"]
  assert.deepEqual(Model.fitCaption(forms, 200, 11, 7, plain), { text: "Northwind 15.3" + IN, pixelSize: 11, elided: false })
  assert.deepEqual(Model.fitCaption(forms, 90, 11, 7, plain), { text: "Northwind 15" + IN, pixelSize: 11, elided: false })
  assert.deepEqual(Model.fitCaption(forms, 60, 11, 7, plain), { text: "Northwind", pixelSize: 11, elided: false })
})

test("fitCaption: when nothing fits, the last form shrinks to the largest size that fits, down to the minimum", () => {
  const forms = ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"]
  // 9 characters: 54 px at 10, 48.6 at 9, 43.2 at 8, 37.8 at 7.
  assert.deepEqual(Model.fitCaption(forms, 50, 11, 7, plain), { text: "Northwind", pixelSize: 9, elided: false })
  assert.deepEqual(Model.fitCaption(forms, 44, 11, 7, plain), { text: "Northwind", pixelSize: 8, elided: false })
  assert.deepEqual(Model.fitCaption(forms, 38, 11, 7, plain), { text: "Northwind", pixelSize: 7, elided: false })
})

test("fitCaption: below the minimum the last form is kept at the minimum, marked for eliding", () => {
  const forms = ["Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind"]
  assert.deepEqual(Model.fitCaption(forms, 30, 11, 7, plain), { text: "Northwind", pixelSize: 7, elided: true })
  // A caption size already at or under the minimum does not grow.
  assert.deepEqual(Model.fitCaption(forms, 30, 7, 7, plain), { text: "Northwind", pixelSize: 7, elided: true })
  assert.deepEqual(Model.fitCaption(forms, 30, 6, 7, plain), { text: "Northwind", pixelSize: 6, elided: true })
})

test("fitCaption: no forms, or empty ones, give an empty caption", () => {
  assert.deepEqual(Model.fitCaption([], 50, 11, 7, plain), { text: "", pixelSize: 11, elided: false })
  assert.deepEqual(Model.fitCaption(undefined, 50, 11, 7, plain), { text: "", pixelSize: 11, elided: false })
  assert.deepEqual(Model.fitCaption(["", "Northwind"], 60, 11, 7, plain), { text: "Northwind", pixelSize: 11, elided: false })
})

test("fitCaption: duplicates fall back to the tail, never to anything else", () => {
  const forms = ["Northwind 15.3" + IN + " (0742)", "Northwind 15" + IN + " (0742)", "Northwind 0742", "0742"]
  assert.equal(Model.fitCaption(forms, 100, 11, 7, plain).text, "Northwind 0742")
  assert.equal(Model.fitCaption(forms, 44, 11, 7, plain).text, "0742")
  assert.deepEqual(Model.fitCaption(forms, 10, 11, 7, plain), { text: "0742", pixelSize: 7, elided: true })
})

test("a unique external never yields its serial tail, whatever the room", () => {
  const d = displays([laptop(), northwind("DEMO00000742")])
  assert.equal(d[1].tag, "742", "the tag itself is unchanged, the rectangles just never show it")
  for (const form of d[1].captions) assert.ok(!form.includes("742"), form)
  for (let px = 6; px <= 14; px++)
    for (let room = 0; room <= 200; room++) {
      const fit = Model.fitCaption(d[1].captions, room, px, Model.CAPTION_MIN_PX, measure)
      assert.ok(!fit.text.includes("742"), `${room} px at ${px}: ${fit.text}`)
      assert.ok(fit.text.startsWith("Northwind"), `${room} px at ${px}: ${fit.text}`)
    }
  for (const grid of [BASE14, TIGHT, gridFor(12), gridFor(12, 400)])
    for (const lua of [WIRED, SCALE_125])
      for (const tile of oneExternal(lua))
        for (const r of tileRects(tile, grid)) {
          assert.ok(!captionOf(r).text.includes("742"), tile.id)
          assert.ok(!overlayOf(r).text.includes("742"), tile.id)
        }
})

test("base-size 14 grid, one external, laptop scale 1: the brand at 11 px in every arrangement tile, the full label on the mirror", () => {
  assert.deepEqual(BASE14, { width: 547, spacing: 9 })
  const seen = {}
  for (const tile of oneExternal()) {
    const r = external(tileRects(tile, BASE14))
    const kind = kindOf(tile)
    seen[kind] = true
    if (kind === "mirror") {
      assert.deepEqual([r.w, r.h, r.overlaySize, r.room], [108, 67, 10, 104], kind)
      assert.deepEqual(overlayOf(r), { text: "Northwind 15.3" + IN, pixelSize: 10, elided: false }, kind)
      continue
    }
    if (kind === "off") {
      assert.deepEqual([r.w, r.h, r.captionSize, r.room], [91, 50, 14, 87], kind)
      assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 14, elided: false }, kind)
      continue
    }
    // above and below: 66x36 rectangles; left and right: 65x36. Caption size
    // 14, 62 or 61 px of room: the brand at 11 px.
    assert.deepEqual([r.w === 66 ? 65 : r.w, r.h, r.captionSize, r.room - (r.w - 65)], [65, 36, 14, 61], `${kind}: ${r.w}x${r.h}`)
    assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 11, elided: false }, kind)
  }
  assert.deepEqual(Object.keys(seen).sort(), ["above", "below", "left", "mirror", "off", "right"])
})

test("the narrow grid (431 px), one external, laptop scale 1: the brand shrinks to 8 px (why the card is Style.space(500))", () => {
  assert.deepEqual(TIGHT, { width: 431, spacing: 9 })
  for (const tile of oneExternal()) {
    const r = external(tileRects(tile, TIGHT))
    const kind = kindOf(tile)
    if (kind === "mirror") assert.deepEqual(overlayOf(r), { text: "Northwind 15" + IN, pixelSize: 9, elided: false }, kind)
    else if (kind === "off") assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 12, elided: false }, kind)
    else {
      assert.deepEqual([r.w, r.h, r.captionSize, r.room], [50, 27, 11, 46], kind)
      assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 8, elided: false }, kind)
    }
  }
})

test("base-size 14 grid, one external, laptop scale 1.25: the brand at 12 px", () => {
  for (const tile of oneExternal(SCALE_125)) {
    const r = external(tileRects(tile, BASE14))
    const kind = kindOf(tile)
    if (kind === "mirror") {
      assert.deepEqual(overlayOf(r), { text: "Northwind 15.3" + IN, pixelSize: 10, elided: false }, kind)
    } else if (kind === "off") {
      assert.deepEqual([r.w, r.h, r.captionSize], [98, 54, 14], kind)
      assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 14, elided: false }, kind)
    } else {
      // 74x41 above and below, 73x40 left and right.
      assert.deepEqual([r.w === 74 ? 73 : r.w, r.h === 41 ? 40 : r.h, r.captionSize], [73, 40, 14], `${kind}: ${r.w}x${r.h}`)
      assert.deepEqual(captionOf(r), { text: "Northwind", pixelSize: 12, elided: false }, kind)
    }
  }
})

test("base-size 14 grid, two identical externals: the serial tail at the caption size, in every tile", () => {
  for (const [lua, rowPx] of [[WIRED, 10], [SCALE_125, 11]]) {
    const tiles = twoExternals(lua)
    assert.ok(tiles.length >= 10, "two-external catalog")
    for (const tile of tiles)
      for (const r of tileRects(tile, BASE14).filter((x) => !x.laptop)) {
        const want = r.key.endsWith("0742") ? "0742" : "0519"
        assert.deepEqual(captionOf(r), { text: want, pixelSize: r.captionSize, elided: false }, tile.id)
        // Three-in-a-row tiles: 43x23 rectangles at scale 1 (46x25 at 1.25); the others 65x36 and up, caption size 14.
        if (kindOf(tile) === "row") assert.deepEqual([r.captionSize, r.room >= 39], [rowPx, true], `${tile.id}: ${r.w}x${r.h}`)
        else assert.deepEqual([r.captionSize, r.room >= 61], [14, true], `${tile.id}: ${r.w}x${r.h}`)
      }
  }
  // The narrow grid: the same tails, down to 7 px in the three-in-a-row tiles.
  for (const tile of twoExternals())
    for (const r of tileRects(tile, TIGHT).filter((x) => !x.laptop)) {
      assert.deepEqual(captionOf(r), { text: r.key.endsWith("0742") ? "0742" : "0519", pixelSize: r.captionSize, elided: false }, tile.id)
      assert.ok(r.captionSize >= 7 && r.room >= 27, `${tile.id}: ${r.w}x${r.h}`)
    }
})

const DELL = { name: "DP-2", description: "Dell Inc. U2415 ABC", make: "Dell Inc.", model: "U2415", serial: "ABC", physicalWidth: 520, physicalHeight: 320, width: 1920, height: 1200, refreshRate: 60, x: 0, y: 0, scale: 1, transform: 0, disabled: false, mirrorOf: "none", focused: false, availableModes: ["1920x1200@60.00Hz"] }
const mixedExternals = (lua = WIRED) => Model.catalog(configured([laptop(), northwind("DEMO00000742"), DELL], lua))

test("base-size 14 grid, two different externals: the brand whole everywhere, at 7 px in the three-in-a-row tiles", () => {
  for (const tile of mixedExternals())
    for (const r of tileRects(tile, BASE14).filter((x) => !x.laptop)) {
      const fit = captionOf(r)
      assert.ok(!fit.text.includes("742") && !fit.text.includes("ABC"), `${tile.id}: ${fit.text}`)
      if (r.key.endsWith("0742")) {
        assert.equal(fit.text, "Northwind", tile.id)
        assert.equal(fit.elided, false, `${tile.id}: ${JSON.stringify(fit)} in ${r.w}x${r.h}`)
        if (kindOf(tile) === "row") assert.deepEqual([r.w, r.h, fit.pixelSize], [43, 23, 7], tile.id)
        else assert.ok(fit.pixelSize >= 10, `${tile.id}: ${JSON.stringify(fit)} in ${r.w}x${r.h}`)
      } else {
        assert.deepEqual(fit, { text: "Dell", pixelSize: r.captionSize, elided: false }, tile.id)
      }
    }
})

test("the narrow grid, two different externals: the shrink-then-elide fallback, elided only in the three-in-a-row tiles", () => {
  for (const tile of mixedExternals())
    for (const r of tileRects(tile, TIGHT).filter((x) => !x.laptop)) {
      const fit = captionOf(r)
      assert.ok(!fit.text.includes("742") && !fit.text.includes("ABC"), `${tile.id}: ${fit.text}`)
      if (r.key.endsWith("0742")) {
        assert.equal(fit.text, "Northwind", tile.id)
        assert.equal(fit.elided, kindOf(tile) === "row", `${tile.id}: ${JSON.stringify(fit)} in ${r.w}x${r.h}`)
        if (kindOf(tile) === "row") assert.deepEqual([r.w, r.h, fit.pixelSize], [33, 17, 7], tile.id)
      } else {
        assert.deepEqual(fit, { text: "Dell", pixelSize: r.captionSize, elided: false }, tile.id)
      }
    }
})

test("default base size (12): the brand everywhere in the one-external grid too, 9 px or more", () => {
  const grid = gridFor(12)
  assert.deepEqual(grid, { width: 468, spacing: 8 })
  for (const lua of [WIRED, SCALE_125])
    for (const tile of oneExternal(lua)) {
      const r = external(tileRects(tile, grid))
      const fit = kindOf(tile) === "mirror" ? overlayOf(r) : captionOf(r)
      assert.ok(fit.text.startsWith("Northwind") && !fit.elided && fit.pixelSize >= 9, `${tile.id}: ${JSON.stringify(fit)} in ${r.w}x${r.h}`)
    }
  // A Style.space(400) card at the default base size (a 368 px grid) shows the brand whole too.
  for (const tile of oneExternal()) {
    const r = external(tileRects(tile, gridFor(12, 400)))
    const fit = kindOf(tile) === "mirror" ? overlayOf(r) : captionOf(r)
    assert.ok(fit.text.startsWith("Northwind") && !fit.elided, `${tile.id}: ${JSON.stringify(fit)} in ${r.w}x${r.h}`)
  }
})
