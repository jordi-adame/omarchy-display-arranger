// The sequence that exposed the scale bug (a tile clicked while mirroring
// froze the toggle's temporary scale), step by step, through the real
// apply.sh (stub commands that write Omarchy's flag files like the real ones)
// and the real generated file, evaluated like Hyprland loads the config:
// wired monitors.lua, then its require of the generated file, then Omarchy's
// toggle flags. After every step the external must have the expected scale
// and the enabled displays must touch without overlapping.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const {
  Model, WIRED, DESC_742, KEY_742,
  laptop, northwind, configured, runConfig, effectiveRule, layout, assertSound, iconScale,
  stubEnv, runApply, tmpdir
} = require("./helpers.js")

delete process.env.HYPRLAND_INSTANCE_SIGNATURE

const v742 = () => northwind("DEMO00000742")
const EXT_RULE = (calls) => effectiveRule(calls, v742())
const LAP_RULE = (calls) => effectiveRule(calls, laptop())

// One "machine": monitors.lua text, the flags directory and the generated
// file live in the stub's fake home; clicks run apply.sh with a plan built
// from the given live snapshot, like the panel does.
function machine(monitorsLua = WIRED) {
  const stub = stubEnv()
  const state = { monitorsLua, stub }
  state.effective = () => runConfig(state.monitorsLua, fs.existsSync(stub.target) ? fs.readFileSync(stub.target, "utf8") : null, stub.flags())
  state.click = (kind, snapshot) => {
    // Like Panel.qml: the previous file's fallback scales are read before the plan is built.
    const previous = fs.existsSync(stub.target) ? Model.parseFallbackScales(fs.readFileSync(stub.target, "utf8")) : {}
    const d = configured(snapshot, state.monitorsLua, previous)
    const tile = Model.catalog(d).find((t) => t.kind === kind)
    const plan = Model.applyPlan(tile, d, { writtenAt: "2026-11-07T21:44:46Z" })
    const res = runApply(stub, ["apply", plan.mode, plan.luaText, plan.evalExpr, plan.evalExprLidClosed])
    assert.equal(res.status, 0, res.stderr)
    return { plan, calls: state.effective() }
  }
  state.file = () => fs.readFileSync(stub.target, "utf8").replace(/-- written: .*\n/, "")
  return state
}

// Live snapshots as hyprctl would report them at each step.
const SNAP_CLEAN_ABOVE = [laptop({ x: 0, y: 0 }), northwind("DEMO00000742", { x: 0, y: -1080 })]
// Mirroring: Omarchy's toggle rule sets the external to scale 1 and position auto.
const SNAP_MIRRORED = [laptop({ x: 0, y: 0 }), northwind("DEMO00000742", { scale: 1, mirrorOf: "eDP-1", x: 1920, y: 0 })]
// Laptop off: the panel is disabled and reports no size.
const SNAP_LAPTOP_OFF = [laptop({ disabled: true, width: 0, height: 0, scale: 1 }), northwind("DEMO00000742", { x: 0, y: 0 })]

function expectExternal(calls, scale, position, what) {
  const rule = EXT_RULE(calls)
  assert.equal(rule.scale, scale, `${what}: external scale`)
  assert.equal(rule.position, position, `${what}: external position`)
  assert.ok(!rule.mirror, `${what}: not mirroring`)
  const rects = layout(calls, [laptop(), v742()])
  assert.equal(rects.length, 2, `${what}: both displays on`)
  assertSound(assert, rects, what)
}

test("the scale-bug sequence: above at scale 2, mirror on, above again, Display panel 1x then 2x", () => {
  const m = machine()

  // 1. external at scale 2, "above".
  let r = m.click("above", SNAP_CLEAN_ABOVE)
  expectExternal(r.calls, 2, "0x-1080", "step 1 above")
  assert.deepEqual(LAP_RULE(r.calls), { output: "eDP-1", mode: "preferred", position: "0x0", scale: 1, rank: LAP_RULE(r.calls).rank })
  const fileAfterStep1 = m.file()

  // 2. mirror on: apply.sh writes the file, Omarchy's toggle flag mirrors at scale 1.
  r = m.click("mirror", SNAP_CLEAN_ABOVE)
  assert.deepEqual(Object.keys(m.stub.flags()), ["internal-monitor-mirror"])
  let ext = EXT_RULE(r.calls)
  assert.equal(ext.scale, 1, "while mirroring Omarchy's rule gives scale 1")
  assert.equal(ext.mirror, "eDP-1")
  assert.equal(ext.position, "auto")

  // 3. "above" clicked while mirrored: the plan is built from the mirrored snapshot.
  r = m.click("above", SNAP_MIRRORED)
  assert.deepEqual(Object.keys(m.stub.flags()), [], "mirror flag lifted")
  expectExternal(r.calls, 2, "0x-1080", "step 3 above after mirror")
  assert.equal(m.file(), fileAfterStep1, "the file does not depend on the mirrored live state")

  // 4. Display panel: external to 1x (a DP-1 rule after the catch-all), then back to 2x.
  m.monitorsLua = iconScale(m.monitorsLua, "DP-1", 1)
  let calls = m.effective()
  expectExternal(calls, 1, "-960x-2160", "step 4a Display panel 1x")
  assert.equal(EXT_RULE(calls).mode, "preferred", "mode follows the Display panel's rule")
  m.monitorsLua = iconScale(m.monitorsLua, "DP-1", 2)
  calls = m.effective()
  expectExternal(calls, 2, "0x-1080", "step 4b Display panel 2x")
  assert.equal(m.monitorsLua.split("\n").filter((l) => l.startsWith('hl.monitor({ output = "DP-1"')).length, 1, "one DP-1 rule, edited in place")

  // Another click after the Display panel change keeps 2x.
  r = m.click("right", [laptop({ x: 0, y: 0 }), northwind("DEMO00000742", { x: 0, y: -1080 })])
  expectExternal(r.calls, 2, "1920x60", "right after Display panel 2x")
  assert.match(r.plan.evalExpr, /scale = 2, disabled = false \}\)$/, "the live eval carries the configured scale")
})

test("laptop off, then back to above", () => {
  const m = machine()
  m.click("above", SNAP_CLEAN_ABOVE)

  let r = m.click("off", SNAP_CLEAN_ABOVE)
  assert.deepEqual(Object.keys(m.stub.flags()), ["internal-monitor-disable"])
  assert.equal(LAP_RULE(r.calls).disabled, true, "Omarchy's flag disables the laptop")
  assert.equal(LAP_RULE(r.calls).position, "0x1080", "the laptop rule keeps its place below for later")
  const ext = EXT_RULE(r.calls)
  assert.equal(ext.scale, 2)
  assert.equal(ext.position, "0x0")
  assert.deepEqual(layout(r.calls, [laptop(), v742()]).map((x) => x.name), ["DP-1"], "only the external is on")

  r = m.click("above", SNAP_LAPTOP_OFF)
  assert.deepEqual(Object.keys(m.stub.flags()), [], "disable flag lifted")
  expectExternal(r.calls, 2, "0x-1080", "above after laptop off")
  assert.equal(LAP_RULE(r.calls).scale, 1)
  assert.equal(LAP_RULE(r.calls).disabled, undefined)
})

test("laptop scale change: via local omarchy_monitor_scale and via the Display panel's literal", () => {
  const m = machine()
  m.click("above", SNAP_CLEAN_ABOVE)

  m.monitorsLua = WIRED.replace(/^local omarchy_monitor_scale = 1$/m, "local omarchy_monitor_scale = 1.25")
  let calls = m.effective()
  assert.equal(LAP_RULE(calls).scale, 1.25)
  expectExternal(calls, 2, "-192x-1080", "omarchy_monitor_scale = 1.25")

  m.monitorsLua = iconScale(WIRED, "eDP-1", 1.6)
  calls = m.effective()
  assert.equal(LAP_RULE(calls).scale, 1.6)
  expectExternal(calls, 2, "-360x-1080", "Display panel laptop 1.6")

  // The clamshell script reads the same laptop scale: eDP-1 rule, else catch-all, else the local.
  m.monitorsLua = iconScale(WIRED, "eDP-1", 2)
  calls = m.effective()
  assert.equal(LAP_RULE(calls).scale, 2)
  expectExternal(calls, 2, "-480x-1080", "Display panel laptop 2")
})

test("mirror on while the Display panel has set 1x: leaving mirror restores 1x and the layout for it", () => {
  const m = machine(iconScale(WIRED, "DP-1", 1))
  let r = m.click("above", [laptop({ x: 0, y: 0 }), northwind("DEMO00000742", { scale: 1, x: -960, y: -2160 })])
  expectExternal(r.calls, 1, "-960x-2160", "1x above")
  r = m.click("mirror", [laptop({ x: 0, y: 0 }), northwind("DEMO00000742", { scale: 1, x: -960, y: -2160 })])
  assert.equal(EXT_RULE(r.calls).mirror, "eDP-1")
  r = m.click("left", SNAP_MIRRORED)
  expectExternal(r.calls, 1, "-3840x-480", "1x left after mirror")
})

// Omarchy's default monitors.lua: no numeric scale anywhere, no rule for the
// external, so every scale is "auto" and unreadable. The fixture laptop
// (1920x1200 on 300x190 mm) runs at Hyprland's auto 1.5, the 4K external
// (340x190 mm) at 2.
// The require line is what the first click appends (wiring.test.js).
const AUTO_DEFAULT = 'local omarchy_gdk_scale = 1\nlocal omarchy_monitor_scale = "auto"\n' +
  'hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))\n' +
  'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })\n' +
  '\n-- Display arrangement from the jordi-adame.display-arranger bar widget. Keep this the last line.\nrequire("hypr.display-arrangement")\n'
const SNAP_AUTO_ABOVE = () => [laptop({ scale: 1.5, x: 0, y: 0 }), northwind("DEMO00000742", { scale: 2, x: -320, y: -1080 })]

// "above" at the auto scales: the external (1920x1080 logical) centered over a 1280x800 laptop.
function expectAutoAbove(calls, file, what) {
  assert.equal(EXT_RULE(calls).position, "-320x-1080", what + ": external position")
  assert.equal(EXT_RULE(calls).scale, undefined, what + ": no scale in the rule, Hyprland keeps auto")
  assert.equal(LAP_RULE(calls).position, "0x0", what + ": laptop position")
  assert.match(file, /DEMO00000742[^\n]*fallback_scale = 2 \}/, what + ": external fallback")
  assert.match(file, /"eDP-1"[^\n]*fallback_scale = 1\.5 \}/, what + ": laptop fallback")
}

test("auto scale, 4K external: above, mirror on, above again keep the positions for scale 2", () => {
  const m = machine(AUTO_DEFAULT)
  let r = m.click("above", SNAP_AUTO_ABOVE())
  expectAutoAbove(r.calls, m.file(), "step 1 above")

  r = m.click("mirror", SNAP_AUTO_ABOVE())
  assert.equal(EXT_RULE(r.calls).mirror, "eDP-1")
  assert.match(m.file(), /DEMO00000742[^\n]*fallback_scale = 2 \}/, "mirror click keeps the trustworthy live 2")

  // Back to "above" while mirrored: the external's live scale (1, from Omarchy's
  // mirror rule) is not trustworthy; Hyprland's own auto scale for it is 2.
  r = m.click("above", [laptop({ scale: 1.5 }), northwind("DEMO00000742", { scale: 1, mirrorOf: "eDP-1", x: 1280, y: 0 })])
  assert.deepEqual(Object.keys(m.stub.flags()), [])
  expectAutoAbove(r.calls, m.file(), "step 3 above after mirror")
})

test("auto scale, laptop 1920x1200 on 300x190 mm: laptop off, then above puts the laptop back at its auto scale 1.5", () => {
  const m = machine(AUTO_DEFAULT)
  m.click("off", SNAP_AUTO_ABOVE())
  // Disabled, the laptop reports no size and scale 1: not trustworthy.
  const r = m.click("above", [laptop({ disabled: true, width: 0, height: 0, scale: 1 }), northwind("DEMO00000742", { scale: 2, x: 0, y: 0 })])
  expectAutoAbove(r.calls, m.file(), "above after laptop off")
})

test("auto scale, no physical size: an untrustworthy live scale takes the previous file's fallback, else none is recorded", () => {
  const m = machine(AUTO_DEFAULT)
  const noSize = (over) => northwind("DEMO00000742", Object.assign({ physicalWidth: 0, physicalHeight: 0 }, over))
  // Nothing trustworthy, nothing to compute, no previous file: no fallback, positions for 1.
  let r = m.click("above", [laptop({ scale: 1.5 }), noSize({ scale: 1, mirrorOf: "eDP-1", x: 1280, y: 0 })])
  assert.doesNotMatch(m.file(), /DEMO00000742[^\n]*fallback_scale/)
  assert.equal(EXT_RULE(r.calls).position, "-1280x-2160", "3840x2160 at 1, centered over the 1280 px laptop")
  // A clean click records the live 2; the next mirrored click keeps it from the previous file.
  m.click("above", [laptop({ scale: 1.5 }), noSize({ scale: 2, x: -320, y: -1080 })])
  assert.match(m.file(), /DEMO00000742[^\n]*fallback_scale = 2 \}/)
  r = m.click("above", [laptop({ scale: 1.5 }), noSize({ scale: 1, mirrorOf: "eDP-1", x: 1280, y: 0 })])
  assert.match(m.file(), /DEMO00000742[^\n]*fallback_scale = 2 \}/)
  assert.equal(EXT_RULE(r.calls).position, "-320x-1080")
})

// Omarchy's own persist_scale (from omarchy-hyprland-monitor-scaling) edits the
// wired file the way the test helper models it. Sourced with a stub hyprctl
// on PATH and no instance signature, so nothing reaches the live compositor.
const SCALING = "/usr/share/omarchy/bin/omarchy-hyprland-monitor-scaling"
test("Omarchy's persist_scale edits the wired monitors.lua as modelled", { skip: !fs.existsSync(SCALING) && "omarchy not installed" }, () => {
  const dir = tmpdir("persist")
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, "hyprctl"), "#!/bin/bash\necho '[]'\n")
  fs.chmodSync(path.join(bin, "hyprctl"), 0o755)
  const file = path.join(dir, "monitors.lua")
  fs.writeFileSync(file, WIRED)
  const env = { PATH: bin + ":" + process.env.PATH, HOME: dir, XDG_STATE_HOME: path.join(dir, "state") }
  const run = (output, scale) => {
    // The script runs its own `case "$1"` when sourced: with no argument that is
    // a read-only hyprctl query, answered by the stub.
    const res = spawnSync("bash", ["-c", `f=$1; o=$2; s=$3; set -- ""; source "$0" >/dev/null 2>&1; persist_scale "$f" "$o" "$s" 1`, SCALING, file, output, scale], { env, encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    return fs.readFileSync(file, "utf8")
  }
  const afterExternal = run("DP-1", 1)
  assert.equal(afterExternal.replace(/^local omarchy_gdk_scale = .*$/m, "local omarchy_gdk_scale = 1"), iconScale(WIRED, "DP-1", 1))
  const afterLaptop = run("eDP-1", 1.25)
  assert.equal(afterLaptop.replace(/^local omarchy_gdk_scale = .*$/m, "local omarchy_gdk_scale = 1"), iconScale(iconScale(WIRED, "DP-1", 1), "eDP-1", 1.25))
  const again = run("DP-1", 2)
  assert.equal(again.split("\n").filter((l) => l.startsWith('hl.monitor({ output = "DP-1"')).length, 1)
  assert.match(again, /output = "DP-1", mode = "preferred", position = "auto", scale = 2 \}\)/)
  const d = configured([laptop(), v742()], again)
  assert.deepEqual(d.map((x) => x.scale), [1.25, 2])
  const calls = runConfig(again, Model.fileText(Model.catalog(d)[0], d))
  expectExternal(calls, 2, "-192x-1080", "after Omarchy's own edits")
})
