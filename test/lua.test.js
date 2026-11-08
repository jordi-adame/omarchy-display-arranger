// The generated display-arrangement.lua (format 2), parsed and run under the
// system Lua with a stub `hl`, against fake monitors.lua files. Its loader
// must give the same positions as Model.js for the same configuration.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const {
  Model, LIVE, MONITORS_LUA, WIRED, KEY_742, KEY_519,
  laptop, northwind, displays, configured, tmpdir, runLua, iconScale
} = require("./helpers.js")

const tileOf = (d, kind) => Model.catalog(d).find((t) => t.kind === kind)
const fileFor = (d, kind) => Model.fileText(tileOf(d, kind), d, { writtenAt: "2026-11-07T22:00:00Z" })
const one = configured([laptop(), northwind("DEMO00000742")], WIRED)

test("generated file parses (luac -p)", () => {
  const dir = tmpdir("luac")
  const d1 = configured(LIVE, MONITORS_LUA)
  const d2 = configured([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")], MONITORS_LUA)
  for (const [d, tiles] of [[d1, Model.catalog(d1)], [d2, Model.catalog(d2)]]) {
    for (const tile of tiles) {
      const file = path.join(dir, "x.lua")
      fs.writeFileSync(file, Model.fileText(tile, d))
      const res = spawnSync("luac", ["-p", file], { encoding: "utf8" })
      assert.equal(res.status, 0, tile.id + ": " + res.stderr)
    }
  }
})

test("generated file: format 2 stores the arrangement and the displays, no scale, mode or position", () => {
  const text = fileFor(one, "above")
  assert.match(text, /^-- Display arrangement, written by the jordi-adame\.display-arranger bar widget\./)
  assert.match(text, /-- display-arranger-format: 2\n/)
  assert.match(text, /-- written: 2026-11-07T22:00:00Z\n/)
  assert.ok(text.includes(`local last = "${KEY_742} + eDP-1"`))
  assert.ok(text.includes('kind = "above",'))
  assert.ok(text.includes(`order = { "${KEY_742}" },`))
  assert.ok(text.includes('{ output = "eDP-1", name = "eDP-1", description = "LG Display 0x07C8", width = 1920, height = 1200, laptop = true },'))
  assert.ok(text.includes(`{ output = "${KEY_742}", name = "DP-1", description = "Northwind Corporation NW-1560 DEMO00000742", width = 3840, height = 2160 },`))
  const data = text.slice(0, text.indexOf("-- Loader:"))
  assert.doesNotMatch(data, /scale\s*=/, "no scale in the data")
  assert.doesNotMatch(data, /position\s*=/, "no position in the data")
  assert.doesNotMatch(data, /mode\s*=\s*"\d/, "no mode in the data")
  assert.ok(!/output = "DP-\d/.test(text), "externals never addressed by connector name")
})

test("the file is the same whether the click happens while mirroring, with the laptop off, or in a clean state", () => {
  const clean = configured([laptop({ y: 1080 }), northwind("DEMO00000742")], WIRED)
  const mirrored = configured([laptop(), northwind("DEMO00000742", { scale: 1, mirrorOf: "eDP-1", x: 0, y: 0 })], WIRED)
  const laptopOff = configured([laptop({ disabled: true, width: 0, height: 0, scale: 1 }), northwind("DEMO00000742")], WIRED)
  const strip = (t) => t.replace(/-- written: .*\n/, "")
  assert.equal(strip(fileFor(mirrored, "above")), strip(fileFor(clean, "above")))
  assert.equal(strip(fileFor(laptopOff, "above")), strip(fileFor(clean, "above")))
})

test("the pre-plugin monitors.lua fixture (laptop scale via local omarchy_monitor_scale = 1, desc rule scale 2)", () => {
  const calls = runLua(fileFor(one, "above"), MONITORS_LUA)
  assert.deepEqual(calls, [
    { output: "eDP-1", mode: "preferred", position: "0x0", scale: 1 },
    { output: KEY_742, mode: "3840x2160@60", position: "0x-1080", scale: 2 }
  ])
})

// After omarchy-hyprland-monitor-scaling for the laptop, its rule carries a literal.
for (const [s, x] of [[1, 0], [1.25, -192], [1.5, -320], [1.6, -360], [2, -480], [3, -640], [4, -720]]) {
  test(`laptop scale ${s} set from the Display panel: positions follow it`, () => {
    const monitors = iconScale(WIRED, "eDP-1", s)
    assert.notEqual(monitors, WIRED)
    const calls = runLua(fileFor(one, "above"), monitors)
    assert.deepEqual(calls[0], { output: "eDP-1", mode: "preferred", position: "0x0", scale: s })
    assert.deepEqual(calls[1], { output: KEY_742, mode: "3840x2160@60", position: `${x}x-1080`, scale: 2 })
  })
}

test("external scale from the Display panel (rule by connector name after the catch-all) wins over the hand desc: rule", () => {
  const calls = runLua(fileFor(one, "above"), iconScale(WIRED, "DP-1", 1))
  assert.deepEqual(calls[1], { output: KEY_742, mode: "preferred", position: "-960x-2160", scale: 1 })
  const back = runLua(fileFor(one, "above"), iconScale(iconScale(WIRED, "DP-1", 1), "DP-1", 2))
  assert.deepEqual(back[1], { output: KEY_742, mode: "preferred", position: "0x-1080", scale: 2 })
})

test("with the hand desc: rule after the catch-all it comes after the Display panel's rule and keeps winning (why the wired fixture moves it before)", () => {
  const calls = runLua(fileFor(one, "above"), iconScale(MONITORS_LUA, "DP-1", 1))
  assert.equal(calls[1].scale, 2)
})

test("a desc: rule matches by prefix, as in Hyprland", () => {
  const monitors = 'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })\n' +
    'hl.monitor({ output = "desc:Northwind Corporation NW-1560", mode = "preferred", position = "auto", scale = 1.5 })\n'
  const calls = runLua(fileFor(one, "right"), monitors)
  assert.equal(calls[1].scale, 1.5)
  assert.equal(calls[1].position, "1920x-120")
})

test("rules for one output merge: a later rule without scale keeps the earlier scale", () => {
  const monitors = 'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })\n' +
    'hl.monitor({ output = "DP-1", mode = "preferred", position = "auto", scale = 2 })\n' +
    'hl.monitor({ output = "DP-1", transform = 1 })\n'
  const calls = runLua(fileFor(one, "right"), monitors)
  // Turned by the transform, the external is 1080x1920 logical, so it is centered at y = (1200 - 1920) / 2.
  assert.deepEqual(calls[1], { output: KEY_742, mode: "preferred", position: "1920x-360", scale: 2, transform: 1 })
})

test("the last matching rule wins, by connector name or desc:, in either order", () => {
  const a = 'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "preferred", position = "auto", scale = 2 })\n' +
    'hl.monitor({ output = "DP-1", mode = "preferred", position = "auto", scale = 1.5 })\n'
  const b = 'hl.monitor({ output = "DP-1", mode = "preferred", position = "auto", scale = 1.5 })\n' +
    'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "preferred", position = "auto", scale = 2 })\n'
  assert.equal(runLua(fileFor(one, "above"), a)[1].scale, 1.5)
  assert.equal(runLua(fileFor(one, "above"), b)[1].scale, 2)
})

test("scale from the catch-all rule when no rule names the display", () => {
  const monitors = 'local omarchy_monitor_scale = 1\nhl.monitor({ output = "", mode = "preferred", position = "auto", scale = 2 })\n'
  const calls = runLua(fileFor(one, "right"), monitors)
  assert.deepEqual(calls[0], { output: "eDP-1", mode: "preferred", position: "0x0", scale: 2 })
  assert.deepEqual(calls[1], { output: KEY_742, mode: "preferred", position: "960x-240", scale: 2 })
})

test("single-quoted strings in monitors.lua are read by the loader too", () => {
  const monitors = "local panel = '1.25'\n" +
    "hl.monitor({ output = 'eDP-1', mode = 'preferred', position = 'auto', scale = panel })\n" +
    "hl.monitor({ output = 'desc:Northwind Corporation NW-1560 DEMO00000742', mode = '3840x2160@60', position = '0x0', scale = 2 })\n"
  const calls = runLua(fileFor(one, "above"), monitors)
  assert.deepEqual(calls, [
    { output: "eDP-1", mode: "preferred", position: "0x0", scale: 1.25 },
    { output: KEY_742, mode: "3840x2160@60", position: "-192x-1080", scale: 2 }
  ])
})

test("commented-out rules are ignored", () => {
  const monitors = '-- hl.monitor({ output = "eDP-1", scale = 2 })\nhl.monitor({ output = "eDP-1", mode = "preferred", position = "auto", scale = 1.25 })\n' +
    'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "3840x2160@60", position = "0x0", scale = 2 }) -- scale = 1\n'
  const calls = runLua(fileFor(one, "above"), monitors)
  assert.equal(calls[0].scale, 1.25)
  assert.equal(calls[1].scale, 2)
  assert.equal(calls[1].position, "-192x-1080")
})

test("no monitors.lua: rules carry no scale (Hyprland picks auto); positions use the scale each display ran at the click", () => {
  // The fixture laptop runs at 1 and the external at 2, so the file records
  // those as fallbacks and the loader centers a 1920x1080 external.
  const d = configured([laptop(), northwind("DEMO00000742")], "")
  const calls = runLua(fileFor(d, "above"), null)
  assert.deepEqual(calls, [
    { output: "eDP-1", mode: "preferred", position: "0x0" },
    { output: KEY_742, mode: "preferred", position: "0x-1080" }
  ])
})

// Omarchy's default: the catch-all names no number, the external has a rule.
const AUTO = 'local omarchy_monitor_scale = "auto"\n' +
  'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n' +
  'hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "3840x2160@60", position = "0x0", scale = 2 })\n'

test("an unknown scale: the file records the live scale as that display's fallback, nothing for the others", () => {
  const d = configured([laptop({ scale: 1.5 }), northwind("DEMO00000742")], AUTO)
  assert.deepEqual(d.map((x) => [x.scale, x.scaleKnown]), [[1.5, false], [2, true]])
  const text = fileFor(d, "right")
  const data = text.slice(0, text.indexOf("-- Loader:"))
  assert.equal((data.match(/fallback_scale = /g) || []).length, 1)
  assert.match(data, /output = "eDP-1", [^\n]*fallback_scale = 1\.5 \}/)
  assert.doesNotMatch(data, /DEMO00000742[^\n]*fallback_scale/)
})

test("an unknown scale: the loader, the eval and the tiles agree on the live scale at the click", () => {
  const d = configured([laptop({ scale: 1.5 }), northwind("DEMO00000742")], AUTO)
  const tile = Model.catalog(d).find((t) => t.kind === "right")
  // Laptop 1280x800 logical at 1.5; the external (1920x1080) right of it, centered.
  assert.deepEqual(tile.positions, { "eDP-1": { x: 0, y: 0 }, [KEY_742]: { x: 1280, y: -140 } })
  const calls = runLua(Model.fileText(tile, d), AUTO)
  assert.deepEqual(calls, [
    { output: "eDP-1", mode: "preferred", position: "0x0" },
    { output: KEY_742, mode: "3840x2160@60", position: "1280x-140", scale: 2 }
  ])
  assert.match(Model.evalExpression(tile, d), /output = "eDP-1", mode = "preferred", position = "0x0", disabled = false/)
  assert.match(Model.evalExpression(tile, d), /position = "1280x-140", scale = 2/)
})

test("scale \"auto\" or an expression is unknown: no scale in the rule, the earlier rule's own scale is kept by Hyprland", () => {
  const auto = 'local omarchy_monitor_scale = "auto"\nhl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n'
  assert.equal(runLua(fileFor(one, "above"), auto)[0].scale, undefined)
  const expr = 'hl.monitor({ output = "eDP-1", mode = "preferred", position = "auto", scale = 1080 / 720 })\n'
  assert.equal(runLua(fileFor(one, "above"), expr)[0].scale, undefined)
})

test("a hand-written unclean scale is rounded the way Hyprland rounds it", () => {
  const calls = runLua(fileFor(one, "above"), iconScale(WIRED, "eDP-1", 1.3))
  // 1.3 does not divide 1920x1200 into whole pixels; Hyprland lands on 4/3 (1440x900).
  assert.equal(calls[0].scale, 1.3)
  assert.equal(calls[1].position, "-240x-1080")
  assert.deepEqual(Model.logicalSize(configured([laptop()], iconScale(WIRED, "eDP-1", 1.3))[0]), { w: 1440, h: 900 })
})

test("a transform in monitors.lua turns the display", () => {
  const monitors = WIRED.replace(/(output = "eDP-1".*scale = omarchy_monitor_scale)/, "$1, transform = 1")
  assert.notEqual(monitors, WIRED)
  const calls = runLua(fileFor(configured([laptop(), northwind("DEMO00000742")], monitors), "above"), monitors)
  assert.equal(calls[0].transform, 1)
  // Laptop is 1200 wide when turned: the external (1920) is centered on it.
  assert.equal(calls[1].position, "-360x-1080")
})

test("two externals: every display gets a rule", () => {
  const d = configured([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")], WIRED)
  const tile = Model.catalog(d).find((t) => t.id === `above-right:${KEY_742}|${KEY_519}`)
  const calls = runLua(Model.fileText(tile, d), WIRED)
  assert.deepEqual(calls.map((c) => [c.output, c.position, c.scale]), [
    ["eDP-1", "0x0", 1], [KEY_519, "1920x0", 2], [KEY_742, "0x-1080", 2]
  ])
})

test("laptop off and mirror files keep the laptop on (Omarchy's toggles turn it off)", () => {
  const off = runLua(fileFor(one, "off"), WIRED)
  assert.deepEqual(off, [
    { output: "eDP-1", mode: "preferred", position: "0x1080", scale: 1 },
    { output: KEY_742, mode: "3840x2160@60", position: "0x0", scale: 2 }
  ])
  assert.ok(off.every((c) => c.disabled === undefined))
  const mirror = runLua(fileFor(one, "mirror"), WIRED)
  assert.deepEqual(mirror.map((c) => c.position), ["0x0", "0x-1080"])
})

test("a hostile description stays inside its string", () => {
  const evil = 'Evil"}) os.execute("touch /tmp/pwned") hl.monitor({output="x'
  const d = configured([laptop(), { name: "DP-3", description: evil + "\n]]", serial: "S1", width: 1920, height: 1080, refreshRate: 60, scale: 1 }], WIRED)
  const calls = runLua(Model.fileText(Model.catalog(d)[0], d), WIRED)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].output, "desc:" + evil + "\n]]")
  const expr = Model.evalExpression(Model.catalog(d)[0], d)
  const dir = tmpdir("evil")
  const file = path.join(dir, "e.lua")
  fs.writeFileSync(file, expr)
  assert.equal(spawnSync("luac", ["-p", file]).status, 0)
})

// The loader is the Lua twin of Model.js: same scales read, same sizes, same
// positions, for every tile at many scale combinations.
test("loader and Model.js agree on every tile at every scale combination", () => {
  const laptopScales = [1, 1.25, 1.5, 1.6, 2, 3, 4]
  const externalScales = [1, 1.25, 1.5, 2]
  let checked = 0
  for (const ls of laptopScales) {
    for (const es of externalScales) {
      let monitors = iconScale(iconScale(iconScale(WIRED, "eDP-1", ls), "DP-1", es), "DP-2", es)
      for (const list of [
        [laptop(), northwind("DEMO00000742")],
        [laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")]
      ]) {
        const d = configured(list, monitors)
        for (const tile of Model.catalog(d)) {
          const calls = runLua(Model.fileText(tile, d), monitors)
          const expected = d.map((x) => `${x.key}=${tile.positions[x.key].x}x${tile.positions[x.key].y}`).join(" ")
          const got = calls.map((c) => `${c.output}=${c.position}`).join(" ")
          assert.equal(got, expected, `${tile.id} at laptop ${ls}, external ${es}`)
          calls.forEach((c, i) => assert.equal(c.scale, d[i].scale, `${tile.id}: scale of ${c.output}`))
          checked++
        }
      }
    }
  }
  assert.ok(checked > 500, "checked " + checked)
})
