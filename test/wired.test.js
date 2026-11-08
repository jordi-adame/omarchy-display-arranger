// fixtures/monitors-wired.lua (the hand layout at the laptop origin, the hand desc:
// rules before the catch-all, the require line last) loaded together with a
// generated display-arrangement.lua, as Hyprland loads them. A display the
// generated file does not name falls back to its monitors.lua rule; the
// layouts must still neither overlap nor leave a display floating free.
const test = require("node:test")
const assert = require("node:assert/strict")
const { Model, WIRED, laptop, northwind, configured, runConfig, layout, assertSound, overlaps, effectiveRule, iconScale } = require("./helpers.js")

function withScale(s) {
  const text = WIRED.replace(/^local omarchy_monitor_scale = 1$/m, "local omarchy_monitor_scale = " + s)
  assert.ok(s === 1 || text !== WIRED, "scale line replaced")
  return text
}

test("wired monitors.lua: hand rules before the catch-all, laptop rule after it, require line last", () => {
  const lines = WIRED.split("\n")
  const at = (re) => lines.findIndex((l) => re.test(l))
  const desc742 = at(/^hl\.monitor\(\{ output = "desc:Northwind Corporation NW-1560 DEMO00000742"/)
  const desc519 = at(/^hl\.monitor\(\{ output = "desc:Northwind Corporation NW-1560 DEMO00000519"/)
  const catchAll = at(/^hl\.monitor\(\{ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale \}\)$/)
  const laptopRule = at(/^hl\.monitor\(\{ output = "eDP-1", mode = "preferred", position = "0x0", scale = omarchy_monitor_scale \}\)$/)
  assert.ok(desc742 >= 0 && desc519 >= 0 && catchAll >= 0 && laptopRule >= 0, "all four rules present")
  assert.ok(desc742 < catchAll && desc519 < catchAll, "hand rules before the catch-all")
  assert.ok(catchAll < laptopRule, "laptop rule after the catch-all, where the Display panel edits it in place")
  assert.match(WIRED, /\nrequire\("hypr\.display-arrangement"\)\n$/)
  // Every hl.monitor line is one line with a plain scale: what the Display panel can edit.
  for (const l of lines.filter((l) => l.startsWith("hl.monitor(")))
    assert.match(l, /\}\)\s*$/, "one-line rule: " + l)
})

test("wired: the Display panel's external rule lands after the hand rules and wins; the laptop rule is edited in place", () => {
  const edited = iconScale(iconScale(WIRED, "DP-1", 1), "eDP-1", 1.25)
  const lines = edited.split("\n")
  const catchAll = lines.findIndex((l) => l.startsWith('hl.monitor({ output = "",'))
  assert.match(lines[catchAll + 1], /^hl\.monitor\(\{ output = "DP-1", mode = "preferred", position = "auto", scale = 1 \}\)$/)
  assert.equal(lines.filter((l) => l.startsWith('hl.monitor({ output = "eDP-1"')).length, 1)
  assert.match(edited, /output = "eDP-1", mode = "preferred", position = "0x0", scale = 1\.25 \}\)/)
  const calls = runConfig(edited, "-- empty\n")
  assert.equal(effectiveRule(calls, northwind("DEMO00000742")).scale, 1)
  assert.equal(effectiveRule(calls, laptop()).scale, 1.25)
})

// The file a click wrote while one external was connected, then the sets
// that can be connected later. Each listed click agrees with the hand layout
// for the external it does not name.
const CLICKS = [
  ["DEMO00000742", "above"],
  ["DEMO00000742", "left"],
  ["DEMO00000519", "below"]
]

for (const s of [1, 1.25]) {
  const monitorsLua = withScale(s)
  const lap = laptop({ scale: s })
  const v742 = northwind("DEMO00000742")
  const v519 = northwind("DEMO00000519")

  for (const [serial, kind] of CLICKS) {
    test(`panel scale ${s}, file from "${kind}" with ${serial.slice(-3)}: laptop only, one, two externals`, () => {
      const clicked = serial === "DEMO00000742" ? v742 : v519
      const d = configured([lap, clicked], monitorsLua)
      const tile = Model.catalog(d).find((t) => t.kind === kind)
      const calls = runConfig(monitorsLua, Model.fileText(tile, d))
      for (const [what, connected] of [
        ["laptop only", [lap]],
        ["one external", [lap, clicked]],
        ["two externals, file names one", [lap, v742, v519]]
      ]) assertSound(assert, layout(calls, connected), `scale ${s} ${kind} ${what}`)
    })
  }

  test(`panel scale ${s}, no generated rules yet: the hand layout alone is sound`, () => {
    // An empty arrangement: the file exists (the require line needs it) but names nothing.
    const calls = runConfig(monitorsLua, "-- empty\n")
    for (const connected of [[lap], [lap, v742], [lap, v519], [lap, v742, v519]])
      assertSound(assert, layout(calls, connected), `scale ${s} hand layout`)
    const two = layout(calls, [lap, v742, v519])
    assert.deepEqual(two.map((r) => [r.name, r.x, r.y]), [
      ["eDP-1", 0, 0], ["DP-1", Math.floor((1920 / s - 1920) / 2), -1080], ["DP-2", 1920 / s, 0]
    ])
  })
}

test("known limit of last click only: a click that puts one external where the hand layout puts the other overlaps when both connect", () => {
  // "right" with 742 lands where monitors.lua puts 519. Per-set memory (one entry per
  // connected set) or a new click fixes it; this test records the behaviour.
  const d = configured([laptop(), northwind("DEMO00000742")], WIRED)
  const tile = Model.catalog(d).find((t) => t.kind === "right")
  const calls = runConfig(WIRED, Model.fileText(tile, d))
  const rects = layout(calls, [laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")])
  assert.ok(overlaps(rects[1], rects[2]))
})
