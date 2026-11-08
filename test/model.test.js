const test = require("node:test")
const assert = require("node:assert/strict")
const {
  Model, LIVE, MONITORS_LUA, WIRED, KEY_742, KEY_519, DESC_742,
  laptop, northwind, displays, configured, rects, iconScale
} = require("./helpers.js")

const one = (lapOver = {}, extOver = {}, lua = WIRED) => configured([laptop(lapOver), northwind("DEMO00000742", extOver)], lua)
const two = (lapOver = {}, lua = WIRED) => configured([laptop(lapOver), northwind("DEMO00000742"), northwind("DEMO00000519")], lua)
const idsOf = (tiles) => tiles.map((t) => t.id)
const withLaptopScale = (s) => iconScale(WIRED, "eDP-1", s)

// ---------- parsing ----------

test("parse: laptop first, externals keyed by description, FALLBACK skipped", () => {
  const d = displays([
    northwind("DEMO00000742"),
    { name: "FALLBACK", width: 1920, height: 1080, scale: 1 },
    laptop()
  ])
  assert.deepEqual(d.map((x) => x.key), ["eDP-1", KEY_742])
  assert.equal(d[0].isLaptop, true)
  assert.equal(d[1].tag, "742")
})

test("parse: live snapshot", () => {
  const d = displays(LIVE)
  assert.equal(d.length, 2)
  assert.equal(d[0].key, "eDP-1")
  assert.equal(d[1].key, KEY_742)
  assert.deepEqual(Model.logicalSize(d[1]), { w: 1920, h: 1080 })
})

test("parse: identical monitors without serial fall back to the connector name", () => {
  const a = { name: "DP-1", description: "Acme Monitor", serial: "", width: 2560, height: 1440, refreshRate: 60, scale: 1 }
  const b = Object.assign({}, a, { name: "DP-2" })
  const d = displays([laptop(), a, b])
  assert.deepEqual(d.map((x) => x.key), ["eDP-1", "DP-1", "DP-2"])
  assert.deepEqual(d.slice(1).map((x) => x.tag), ["A", "B"])
})

test("parse: a disabled display with no size takes its preferred mode", () => {
  const d = displays([laptop(), northwind("DEMO00000742", { width: 0, height: 0, refreshRate: 0, disabled: true })])
  assert.equal(d[1].width, 3840)
  assert.equal(d[1].height, 2160)
  assert.equal(d[1].refresh, 60)
})

test("parse: bad input gives no displays", () => {
  assert.deepEqual(Model.parseMonitors("not json"), [])
  assert.deepEqual(Model.parseMonitors("{}"), [])
  assert.deepEqual(Model.parseMonitors(""), [])
})

test("logical size follows transform and scale", () => {
  const d = displays([laptop({ transform: 1, scale: 1.25 })])[0]
  assert.deepEqual(Model.logicalSize(d), { w: 960, h: 1536 })
})

test("liveSignature: the same for snapshots that differ only in volatile fields, different when the layout changes", () => {
  // Panel.qml polls hyprctl every 3 s while the popup is open and rebuilds the
  // tiles only when this changes, so focus or workspace changes do not.
  const a = JSON.stringify([laptop({ focused: true, activeWorkspace: { id: 1, name: "1" }, dpmsStatus: true }), northwind("DEMO00000742", { focused: false, specialWorkspace: { id: 0, name: "" } })])
  const b = JSON.stringify([laptop({ focused: false, activeWorkspace: { id: 3, name: "3" }, dpmsStatus: false }), northwind("DEMO00000742", { focused: true, specialWorkspace: { id: -98, name: "special" } })])
  assert.equal(Model.liveSignature(a), Model.liveSignature(b))
  for (const changed of [
    [laptop(), northwind("DEMO00000742", { x: 1920 })],
    [laptop({ disabled: true, width: 0, height: 0 }), northwind("DEMO00000742")],
    [laptop(), northwind("DEMO00000742", { mirrorOf: "eDP-1", scale: 1 })],
    [laptop(), northwind("DEMO00000742", { scale: 1 })],
    [laptop({ transform: 1 }), northwind("DEMO00000742")],
    [laptop()],
    [laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")]
  ]) assert.notEqual(Model.liveSignature(JSON.stringify(changed)), Model.liveSignature(a), JSON.stringify(changed))
  assert.equal(Model.liveSignature("not json"), Model.liveSignature("[]"))
})

test("autoScale: Hyprland's PPI thresholds from the mode and the physical size", () => {
  const ext = displays([northwind("DEMO00000742")])[0]
  assert.equal(Model.autoScale(ext), 2, "4K on 340x190 mm: 287 PPI")
  assert.equal(Model.autoScale(displays([laptop()])[0]), 1.5, "1920x1200 on 300x190 mm: 162 PPI")
  assert.equal(Model.autoScale(displays([northwind("DEMO00000742", { width: 2560, height: 1440, physicalWidth: 600, physicalHeight: 340 })])[0]), 1, "27-inch 1440p: 108 PPI")
  assert.equal(Model.autoScale(displays([northwind("DEMO00000742", { physicalWidth: 0, physicalHeight: 0 })])[0]), null)
  assert.equal(Model.autoScale(displays([northwind("DEMO00000742", { physicalWidth: 340, physicalHeight: 0 })])[0]), null)
  // A literal mode in monitors.lua is what Hyprland runs, so it is what counts.
  const lowMode = configured([northwind("DEMO00000742")], 'hl.monitor({ output = "", mode = "1920x1080@60", position = "auto", scale = "auto" })\n')[0]
  assert.equal(Model.autoScale(lowMode), 1.5, "1080p on the same 15-inch panel: 144 PPI, above 140")
})

test("configured: an unknown scale with an untrustworthy live scale uses Hyprland's auto scale, then the previous fallback, then 1", () => {
  const auto = 'local omarchy_monitor_scale = "auto"\nhl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n'
  const mirrored = one({ scale: 1.5 }, { scale: 1, mirrorOf: "eDP-1" }, auto)
  assert.deepEqual(mirrored.map((x) => [x.scale, x.scaleKnown, x.fallbackScale]), [[1.5, false, 1.5], [2, false, 2]])
  const off = one({ scale: 1, disabled: true, width: 0, height: 0 }, {}, auto)
  assert.deepEqual([off[0].scale, off[0].fallbackScale], [1.5, 1.5], "the disabled laptop at its auto 1.5")
  const noSize = one({ scale: 1.5 }, { scale: 1, mirrorOf: "eDP-1", physicalWidth: 0, physicalHeight: 0 }, auto)
  assert.deepEqual([noSize[1].scale, noSize[1].fallbackScale], [1, null], "nothing to go on: 1 for the maths, nothing recorded")
  const previous = configured([laptop({ scale: 1.5 }), northwind("DEMO00000742", { scale: 1, mirrorOf: "eDP-1", physicalWidth: 0, physicalHeight: 0 })], auto, { [KEY_742]: 2 })
  assert.deepEqual([previous[1].scale, previous[1].fallbackScale], [2, 2], "the previous file's fallback")
  // A known scale never records a fallback, whatever the live state.
  assert.deepEqual(one({}, { scale: 1, mirrorOf: "eDP-1" }).map((x) => x.fallbackScale), [null, null])
})

test("parseFallbackScales: reads the fallback_scale per output key back from a generated file, escapes included", () => {
  const auto = 'local omarchy_monitor_scale = "auto"\nhl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n'
  const odd = { name: "DP-3", description: 'Écran "4K" \\ ü', serial: "S1", make: "Acme", model: "X", physicalWidth: 600, physicalHeight: 340, width: 3840, height: 2160, refreshRate: 60, scale: 1.5 }
  const d = configured([laptop({ scale: 1.5 }), odd], auto)
  const text = Model.fileText(Model.catalog(d)[0], d)
  assert.deepEqual(Model.parseFallbackScales(text), { "eDP-1": 1.5, ["desc:" + odd.description]: 1.5 })
  assert.deepEqual(Model.parseFallbackScales(""), {})
  assert.deepEqual(Model.parseFallbackScales("not a file"), {})
  const known = Model.fileText(Model.catalog(one())[0], one())
  assert.deepEqual(Model.parseFallbackScales(known), {}, "no fallbacks when every scale is configured")
})

// ---------- monitors.lua ----------

test("configured: the wired file gives the laptop its local scale and the Northwind its desc: rule", () => {
  const d = one()
  assert.deepEqual(d.map((x) => [x.scale, x.scaleKnown, x.modeText, x.transform, x.rule]), [
    [1, true, "preferred", 0, "eDP-1"],
    [2, true, "3840x2160@60", 0, KEY_742]
  ])
})

test("configured: live scales are replaced, not trusted", () => {
  // Snapshot taken while mirroring: Omarchy's toggle forced the external to scale 1.
  const d = one({}, { scale: 1, mirrorOf: "eDP-1" })
  assert.equal(d[1].scale, 2)
  assert.equal(d[1].liveScale, 1)
  assert.deepEqual(Model.logicalSize(d[1]), { w: 1920, h: 1080 })
})

test("configured: the Display panel's rule by connector name wins over the hand desc: rule in the wired file", () => {
  const d = one({}, {}, iconScale(WIRED, "DP-1", 1))
  assert.equal(d[1].scale, 1)
  assert.equal(d[1].rule, "DP-1")
  assert.equal(d[1].modeText, "preferred")
  assert.deepEqual(Model.logicalSize(d[1]), { w: 3840, h: 2160 })
})

test("configured: rules for one output merge like Hyprland's hl.monitor", () => {
  const lua = 'hl.monitor({ output = "DP-1", mode = "preferred", position = "auto", scale = 2 })\n' +
    'hl.monitor({ output = "DP-1", transform = 3 })\n'
  const d = one({}, {}, lua)
  assert.equal(d[1].scale, 2)
  assert.equal(d[1].transform, 3)
  assert.deepEqual(Model.logicalSize(d[1]), { w: 1080, h: 1920 })
})

test("configured: unknown scale falls back to the live scale when the display is on and not mirroring, else to Hyprland's auto scale", () => {
  const auto = 'local omarchy_monitor_scale = "auto"\nhl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n'
  const clean = one({ scale: 1.5 }, { scale: 2 }, auto)
  assert.deepEqual(clean.map((x) => [x.scale, x.scaleKnown]), [[1.5, false], [2, false]])
  // A toggle's temporary live scale (mirror: 1) is never recorded.
  const mirrored = one({ scale: 1.5 }, { scale: 1, mirrorOf: "eDP-1" }, auto)
  assert.equal(mirrored[1].scale, 2)
  const off = one({ scale: 1.5, disabled: true }, {}, auto)
  assert.equal(off[0].scale, 1.5)
  assert.equal(off[0].scaleKnown, false)
})

test("configured: expressions, quoted locals, bare locals, comments", () => {
  const lua = [
    'local omarchy_monitor_scale = "1.25" -- quoted',
    'local other = 2',
    'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })',
    '-- hl.monitor({ output = "eDP-1", scale = 4 })',
    'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "3840x2160@60", position = "0x0", scale = other }) -- trailing',
    'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000519", mode = "preferred", position = "0x0", scale = 1080 / 540 })'
  ].join("\n")
  const d = two({}, lua)
  assert.deepEqual(d.map((x) => [x.key === "eDP-1" ? "laptop" : x.tag, x.scale, x.scaleKnown]), [
    ["laptop", 1.25, true], ["519", 2, false], ["742", 2, true]
  ])
})

test("configured: single-quoted strings in rules and locals are read like double-quoted ones", () => {
  const lua = "local omarchy_monitor_scale = '1.25'\n" +
    "hl.monitor({ output = '', mode = 'preferred', position = 'auto', scale = omarchy_monitor_scale })\n" +
    "hl.monitor({ output = 'desc:Northwind Corporation NW-1560 DEMO00000742', mode = '3840x2160@60', position = '0x0', scale = 2 })\n"
  const d = one({}, {}, lua)
  assert.deepEqual(d.map((x) => [x.scale, x.scaleKnown, x.modeText, x.rule]), [[1.25, true, "preferred", ""], [2, true, "3840x2160@60", KEY_742]])
})

test("configured: an empty or missing monitors.lua keeps live scales for the pictures", () => {
  const d = one({ scale: 1.25 }, {}, "")
  assert.deepEqual(d.map((x) => [x.scale, x.scaleKnown, x.modeText]), [[1.25, false, "preferred"], [2, false, "preferred"]])
})

test("validScale matches Hyprland's search for a clean scale", () => {
  assert.equal(Model.validScale(1.5, 1920, 1200), 1.5)
  assert.equal(Model.validScale(1.6, 1920, 1200), 1.6)
  assert.equal(Model.validScale(1.25, 1920, 1200), 1.25)
  assert.equal(Model.validScale(1.3, 1920, 1200), 4 / 3)
  assert.equal(Model.validScale(2, 3840, 2160), 2)
  // 1.7 does not divide 3840x2160; the nearest clean step is 200/120.
  assert.equal(Model.validScale(1.7, 3840, 2160), 200 / 120)
})

// ---------- catalog ----------

test("catalog: laptop only gives no tiles and a note", () => {
  const d = configured([laptop()])
  assert.equal(Model.catalog(d).length, 0)
  assert.equal(Model.emptyReason(d), "laptop-only")
})

test("catalog: laptop + 1 external gives above, left, right, below, external only, mirror", () => {
  const tiles = Model.catalog(one())
  assert.deepEqual(tiles.map((t) => t.kind), ["above", "left", "right", "below", "off", "mirror"])
  assert.deepEqual(tiles.map((t) => t.mode), ["normal", "normal", "normal", "normal", "laptop-off", "mirror"])
})

test("catalog: laptop + 2 externals gives 14 distinct tiles", () => {
  const tiles = Model.catalog(two())
  assert.equal(tiles.length, 14)
  assert.equal(new Set(idsOf(tiles)).size, 14)
  const kinds = tiles.map((t) => t.kind)
  assert.equal(kinds.filter((k) => k === "row").length, 6, "every left-to-right order")
  assert.equal(kinds.filter((k) => k === "pair-above").length, 2)
  assert.equal(kinds.filter((k) => k === "above-left" || k === "above-right").length, 4)
  assert.equal(kinds.filter((k) => k === "off-row").length, 2)
})

test("catalog: no laptop, two externals", () => {
  const d = configured([northwind("DEMO00000742"), northwind("DEMO00000519")])
  assert.deepEqual(Model.catalog(d).map((t) => t.kind), ["ext-row", "ext-row", "ext-stack", "ext-stack"])
})

test("catalog: more than two externals gives no tiles", () => {
  const extra = { name: "HDMI-A-1", description: "Acme 27 X1", serial: "X1", width: 2560, height: 1440, refreshRate: 60, scale: 1 }
  const d = configured([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519"), extra])
  assert.equal(Model.catalog(d).length, 0)
  assert.equal(Model.emptyReason(d), "too-many")
})

test("catalog: labels name displays by brand and size, serial tail only for twins", () => {
  const tiles = Model.catalog(two())
  assert.equal(tiles[0].label, "Left to right: Northwind 15.3″ (0519), laptop, Northwind 15.3″ (0742)")
  const lab = Model.catalog(one())
  assert.equal(lab[0].label, "Northwind 15.3″ above the laptop")
  assert.equal(lab[4].label, "Northwind 15.3″ only, laptop off")
})

test("catalog: labels go through the translator", () => {
  const tr = (key, english) => (key === "tile.above" ? "%1 oben" : english)
  assert.equal(Model.catalog(one(), tr)[0].label, "Northwind 15.3″ oben")
})

test("drawing: rectangles carry label, short label and tag", () => {
  const rects = Model.catalog(two())[0].drawing.rects
  const ext = rects.filter((r) => !r.laptop).sort((a, b) => a.key < b.key ? -1 : 1)
  assert.deepEqual(ext.map((r) => [r.label, r.shortLabel, r.tag]), [
    ["Northwind 15.3″ (0519)", "0519", "519"],
    ["Northwind 15.3″ (0742)", "0742", "742"]
  ])
  assert.deepEqual(rects.filter((r) => r.laptop).map((r) => r.label), ["Laptop"])
})

test("tile pictures use the configured size, not a mirrored or disabled live value", () => {
  const mirrored = one({}, { scale: 1, mirrorOf: "eDP-1" })
  const rect = Model.catalog(mirrored)[0].drawing.rects.find((r) => !r.laptop)
  assert.deepEqual([rect.w, rect.h], [1920, 1080])
  const off = one({ disabled: true, width: 0, height: 0, scale: 1 }, {}, withLaptopScale(1.25))
  const lap = Model.catalog(off)[0].drawing.rects.find((r) => r.laptop)
  assert.deepEqual([lap.w, lap.h], [1536, 960])
})

// ---------- position maths ----------

const SCALES = [1, 1.25, 1.5, 2]
const LAPTOP_SIZE = { 1: [1920, 1200], 1.25: [1536, 960], 1.5: [1280, 800], 2: [960, 600] }

for (const s of SCALES) {
  test(`positions at laptop scale ${s}: centered on the shared edge, laptop at 0x0`, () => {
    const d = one({}, {}, withLaptopScale(s))
    const [lw, lh] = LAPTOP_SIZE[s]
    assert.deepEqual(Model.logicalSize(d[0]), { w: lw, h: lh })
    const byKind = {}
    for (const t of Model.catalog(d)) byKind[t.kind] = t.positions
    const cx = Math.floor((lw - 1920) / 2)
    const cy = Math.floor((lh - 1080) / 2)
    assert.deepEqual(byKind.above, { "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: cx, y: -1080 } })
    assert.deepEqual(byKind.below, { "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: cx, y: lh } })
    assert.deepEqual(byKind.left, { "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: -1920, y: cy } })
    assert.deepEqual(byKind.right, { "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: lw, y: cy } })
    // Laptop off: the external starts at 0x0; the laptop rule waits below it.
    assert.deepEqual(byKind.off[KEY_742], { x: 0, y: 0 })
    assert.deepEqual(byKind.off["eDP-1"], { x: Math.floor((1920 - lw) / 2), y: 1080 })
  })
}

test("positions: negative coordinates for above and left at scale 1.25", () => {
  const byKind = {}
  for (const t of Model.catalog(one({}, {}, withLaptopScale(1.25)))) byKind[t.kind] = t.positions[KEY_742]
  assert.deepEqual(byKind.above, { x: -192, y: -1080 })
  assert.deepEqual(byKind.left, { x: -1920, y: -60 })
})

test("positions: external at scale 1 (Display panel) is 3840x2160 logical and still centered", () => {
  const d = one({}, {}, iconScale(WIRED, "DP-1", 1))
  const above = Model.catalog(d).find((t) => t.kind === "above").positions[KEY_742]
  assert.deepEqual(above, { x: -960, y: -2160 })
})

test("positions: two externals, row and pair above", () => {
  const tiles = Model.catalog(two())
  const row = tiles.find((t) => t.id === `row:${KEY_742}|eDP-1|${KEY_519}`)
  assert.deepEqual(row.positions, {
    [KEY_742]: { x: -1920, y: 60 }, "eDP-1": { x: 0, y: 0 }, [KEY_519]: { x: 1920, y: 60 }
  })
  const pair = tiles.find((t) => t.id === `pair-above:${KEY_742}|${KEY_519}`)
  assert.deepEqual(pair.positions, {
    "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: -960, y: -1080 }, [KEY_519]: { x: 960, y: -1080 }
  })
})

test("positions: one above, one right matches the hand layout in monitors.lua", () => {
  const tile = Model.catalog(two()).find((t) => t.id === `above-right:${KEY_742}|${KEY_519}`)
  assert.deepEqual(tile.positions, {
    "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: 0, y: -1080 }, [KEY_519]: { x: 1920, y: 0 }
  })
})

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function touches(a, b) {
  const xTouch = (a.x + a.w === b.x || b.x + b.w === a.x) && a.y < b.y + b.h && b.y < a.y + a.h
  const yTouch = (a.y + a.h === b.y || b.y + b.h === a.y) && a.x < b.x + b.w && b.x < a.x + a.w
  return xTouch || yTouch
}

for (const s of [1, 1.25, 1.5, 1.6, 2, 3, 4]) {
  for (const es of [1, 2]) {
    test(`every tile at laptop scale ${s}, external scale ${es}: no overlap, no display left floating`, () => {
      const lua = iconScale(iconScale(withLaptopScale(s), "DP-1", es), "DP-2", es)
      for (const d of [one({}, {}, lua), two({}, lua)]) {
        const sizes = Model.sizesFor(d)
        for (const spec of Model.specs(d)) {
          if (spec.kind === "mirror") continue
          const mode = spec.kind.startsWith("off") ? "laptop-off" : "normal"
          const r = rects(spec, sizes, mode)
          for (let i = 0; i < r.length; i++) {
            for (let j = i + 1; j < r.length; j++)
              assert.ok(!overlaps(r[i], r[j]), `${spec.kind} ${r[i].name} overlaps ${r[j].name}`)
            assert.ok(r.length === 1 || r.some((o, j) => j !== i && touches(r[i], o)), `${spec.kind} ${r[i].name} touches nothing`)
          }
        }
      }
    })
  }
}

// ---------- current arrangement ----------

test("current: live snapshot (742 at 0x0, laptop below at 0x1080) is 'above'", () => {
  const d = configured(LIVE, MONITORS_LUA)
  const tiles = Model.catalog(d)
  assert.equal(Model.currentTileId(tiles, d), `above:${KEY_742}`)
})

test("current: shift does not matter, only relative position", () => {
  const d = one({ x: 500, y: 500 }, { x: 500 + 1920, y: 500 + 60 })
  assert.equal(Model.currentTileId(Model.catalog(d), d), `right:${KEY_742}`)
})

test("current: laptop disabled matches external only", () => {
  const d = one({ disabled: true })
  assert.equal(Model.currentTileId(Model.catalog(d), d), `off:${KEY_742}`)
})

test("current: mirroring matches mirror", () => {
  const d = one({}, { mirrorOf: "eDP-1", scale: 1 })
  assert.equal(Model.currentTileId(Model.catalog(d), d), `mirror:${KEY_742}`)
})

test("current: an arrangement with no tile matches nothing", () => {
  const d = one({ x: 0, y: 0 }, { x: 300, y: -1080 })
  assert.equal(Model.currentTileId(Model.catalog(d), d), "")
})

test("current: two externals, hand layout from monitors.lua", () => {
  const d = configured([
    laptop({ x: 0, y: 1080 }),
    northwind("DEMO00000742", { x: 0, y: 0 }),
    northwind("DEMO00000519", { x: 1920, y: 1080 })
  ])
  assert.equal(Model.currentTileId(Model.catalog(d), d), `above-right:${KEY_742}|${KEY_519}`)
})

// ---------- live eval text ----------

test("eval: one hl.monitor per display, externals by desc, configured scales and modes", () => {
  const d = configured(LIVE, MONITORS_LUA)
  const tile = Model.catalog(d).find((t) => t.kind === "right")
  assert.equal(Model.evalExpression(tile, d),
    'hl.monitor({ output = "eDP-1", mode = "preferred", position = "0x0", scale = 1, disabled = false }) ' +
    `hl.monitor({ output = "desc:${DESC_742}", mode = "3840x2160@60", position = "1920x60", scale = 2, disabled = false })`)
})

test("eval: an unknown scale is left out, so Hyprland keeps the rule's own", () => {
  const d = one({}, {}, "")
  assert.doesNotMatch(Model.evalExpression(Model.catalog(d)[0], d), /scale =/)
})

test("eval: a configured transform is carried", () => {
  const lua = iconScale(WIRED, "DP-1", 2).replace('position = "auto", scale = 2 })', 'position = "auto", scale = 2, transform = 1 })')
  const d = one({}, {}, lua)
  assert.match(Model.evalExpression(Model.catalog(d)[0], d), /desc:.*transform = 1, disabled = false/)
})

test("eval: lid closed keeps the laptop's disabled state", () => {
  const d = configured(LIVE, MONITORS_LUA)
  const plan = Model.applyPlan(Model.catalog(d)[0], d)
  assert.match(plan.evalExprLidClosed, /^hl\.monitor\(\{ output = "eDP-1", mode = "preferred", position = "0x0", scale = 1 \}\)/)
  assert.match(plan.evalExpr, /"eDP-1".*disabled = false/)
})

test("plan: laptop off evals only externals; mirror evals nothing", () => {
  const d = configured(LIVE, MONITORS_LUA)
  const tiles = Model.catalog(d)
  const off = Model.applyPlan(tiles.find((t) => t.mode === "laptop-off"), d)
  assert.equal(off.mode, "laptop-off")
  assert.doesNotMatch(off.evalExpr, /eDP-1/)
  assert.match(off.evalExpr, /position = "0x0"/)
  const mirror = Model.applyPlan(tiles.find((t) => t.mode === "mirror"), d)
  assert.equal(mirror.mode, "mirror")
  assert.equal(mirror.evalExpr, "")
})

// ---------- Lua strings ----------

test("luaString escapes quotes, backslashes, control and non-ASCII bytes", () => {
  assert.equal(Model.luaString('a"b\\c'), '"a\\"b\\\\c"')
  assert.equal(Model.luaString("x\ny"), '"x\\010y"')
  assert.equal(Model.luaString("é"), '"\\195\\169"')
  assert.equal(Model.luaString("]]--"), '"]]--"')
})
