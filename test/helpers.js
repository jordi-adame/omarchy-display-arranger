// Shared fixtures and runners for the tests. Monitor objects follow the shape
// of `hyprctl monitors all -j` on Hyprland 0.56.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const PLUGIN = path.resolve(__dirname, "..")
// The tests run against the version folder the manifest loads (v1/ today).
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8"))
const VERSION_DIR = path.join(PLUGIN, path.dirname(MANIFEST.entryPoints.barWidget))
const Model = require(path.join(VERSION_DIR, "Model.js"))

const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "live-laptop-one-external.json"), "utf8"))
// A hand-written monitors.lua before the plugin: desc: rules after the catch-all.
const MONITORS_LUA = fs.readFileSync(path.join(__dirname, "fixtures", "monitors.lua"), "utf8")
// The same file wired for the plugin: hand rules before the catch-all, the
// require line last (what apply.sh appends on the first click).
const WIRED_PATH = path.join(__dirname, "fixtures", "monitors-wired.lua")
const WIRED = fs.readFileSync(WIRED_PATH, "utf8")

const DESC_742 = "Northwind Corporation NW-1560 DEMO00000742"
const DESC_519 = "Northwind Corporation NW-1560 DEMO00000519"
const KEY_742 = "desc:" + DESC_742
const KEY_519 = "desc:" + DESC_519

function laptop(over = {}) {
  return Object.assign({
    name: "eDP-1", description: "LG Display 0x07C8", make: "LG Display", model: "0x07C8", serial: "",
    physicalWidth: 300, physicalHeight: 190,
    width: 1920, height: 1200, refreshRate: 120.043, x: 0, y: 0, scale: 1, transform: 0,
    disabled: false, mirrorOf: "none", focused: false, availableModes: ["1920x1200@120.04Hz"]
  }, over)
}

function northwind(serial, over = {}) {
  return Object.assign({
    name: serial === "DEMO00000742" ? "DP-1" : "DP-2",
    description: "Northwind Corporation NW-1560 " + serial,
    make: "Northwind Corporation", model: "NW-1560", serial,
    physicalWidth: 340, physicalHeight: 190,
    width: 3840, height: 2160, refreshRate: 60, x: 0, y: 0, scale: 2, transform: 0,
    disabled: false, mirrorOf: "none", focused: false,
    availableModes: ["3840x2160@60.00Hz", "3840x2160@59.94Hz"]
  }, over)
}

// Live displays only (scales as hyprctl reports them).
function displays(list) {
  return Model.parseMonitors(JSON.stringify(list))
}

// Displays as the panel builds them: live snapshot plus monitors.lua.
function configured(list, monitorsLua = WIRED) {
  return Model.configuredDisplays(displays(list), monitorsLua)
}

// Every temp dir lives under one base that is removed when the run ends.
// TMPDIR points it at a scratch folder (the brief: never /tmp).
const TMP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "display-arranger-test-"))
process.on("exit", () => fs.rmSync(TMP_BASE, { recursive: true, force: true }))

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(TMP_BASE, prefix + "-"))
}

function runStub(home, file) {
  const runner = path.join(__dirname, "lua", "run.lua")
  const res = spawnSync("lua", [runner, file], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" })
  if (res.status !== 0) throw new Error("lua failed: " + res.stderr)
  return res.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

// Runs a generated display-arrangement.lua under the system Lua with a stub
// `hl` that records hl.monitor calls, and HOME pointing at a fake home whose
// ~/.config/hypr/monitors.lua holds `monitorsLua` (or no file when null).
function runLua(luaText, monitorsLua) {
  const home = tmpdir("home")
  fs.mkdirSync(path.join(home, ".config", "hypr"), { recursive: true })
  if (monitorsLua !== null && monitorsLua !== undefined)
    fs.writeFileSync(path.join(home, ".config", "hypr", "monitors.lua"), monitorsLua)
  const file = path.join(home, "display-arrangement.lua")
  fs.writeFileSync(file, luaText)
  return runStub(home, file)
}

// Runs a monitors.lua the way Hyprland loads it: the generated file (when
// given) sits at ~/.config/hypr/display-arrangement.lua for its require line,
// and Omarchy's toggle flags (name -> Lua text) load after it, in sorted
// order, like default/hypr/toggles.lua does.
function runConfig(monitorsLua, generatedLua, flags = {}) {
  const home = tmpdir("config")
  const hypr = path.join(home, ".config", "hypr")
  fs.mkdirSync(hypr, { recursive: true })
  fs.writeFileSync(path.join(hypr, "monitors.lua"), monitorsLua)
  if (generatedLua) fs.writeFileSync(path.join(hypr, "display-arrangement.lua"), generatedLua)
  const names = Object.keys(flags).sort()
  const main = path.join(home, "main.lua")
  const quote = (p) => JSON.stringify(p)
  fs.writeFileSync(main, [
    `dofile(${quote(path.join(hypr, "monitors.lua"))})`,
    ...names.map((n) => {
      const file = path.join(home, n + ".lua")
      fs.writeFileSync(file, flags[n])
      return `dofile(${quote(file)})`
    }),
    ""
  ].join("\n"))
  return runStub(home, main)
}

// Hyprland 0.56's rule selection (verified in MonitorRuleManager.cpp,
// Monitor.cpp and a nested instance): hl.monitor calls for one output string
// merge into one rule that ranks at its last call; a monitor takes the
// highest-ranked rule whose output is its connector name or a desc: prefix of
// its description; the catch-all (output "") only when none matches.
function effectiveRule(calls, monitor) {
  const merged = {}
  calls.forEach((c, i) => {
    merged[c.output] = Object.assign({}, merged[c.output] || {}, c, { rank: i })
  })
  let best = null
  for (const output of Object.keys(merged)) {
    if (output === "") continue
    const ok = output.startsWith("desc:")
      ? monitor.description.startsWith(output.slice(5).trim())
      : output === monitor.name
    if (ok && (!best || merged[output].rank > best.rank)) best = merged[output]
  }
  return best || merged[""] || null
}

// Rectangles Hyprland would show for the connected monitors (laptop, northwind
// objects), from the recorded calls. A disabled or mirroring monitor is left out.
function layout(calls, connected) {
  const rects = []
  for (const m of connected) {
    const rule = effectiveRule(calls, m)
    if (!rule) throw new Error(m.name + " has no rule")
    if (rule.disabled === true || rule.mirror) continue
    if (!/^-?\d+x-?\d+$/.test(String(rule.position))) throw new Error(m.name + " gets " + rule.position + ", not a fixed position")
    const [x, y] = rule.position.split("x").map(Number)
    const scale = Number(rule.scale)
    if (!(scale > 0)) throw new Error(m.name + " has no scale: " + JSON.stringify(rule))
    rects.push({ name: m.name, x, y, w: Math.round(m.width / scale), h: Math.round(m.height / scale), scale })
  }
  return rects
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function touches(a, b) {
  const xTouch = (a.x + a.w === b.x || b.x + b.w === a.x) && a.y < b.y + b.h && b.y < a.y + a.h
  const yTouch = (a.y + a.h === b.y || b.y + b.h === a.y) && a.x < b.x + b.w && b.x < a.x + a.w
  return xTouch || yTouch
}

// No two rectangles overlap and none floats free of the others.
function assertSound(assert, rects, what) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i], rects[j]), `${what}: ${rects[i].name} overlaps ${rects[j].name} ${JSON.stringify(rects)}`)
    assert.ok(rects.length === 1 || rects.some((o, j) => j !== i && touches(rects[i], o)),
      `${what}: ${rects[i].name} touches nothing ${JSON.stringify(rects)}`)
  }
}

// What omarchy-hyprland-monitor-scaling's persist_scale does to monitors.lua
// for one output: a one-line rule naming it gets its scale replaced, else a
// rule is added right after the catch-all.
function iconScale(monitorsLua, output, scale) {
  const lines = monitorsLua.split("\n")
  const start = `hl.monitor({ output = "${output}",`
  const idx = lines.findIndex((l) => l.startsWith(start))
  if (idx >= 0) {
    lines[idx] = lines[idx].replace(/([{, ]scale = )("[^"]*"|[A-Za-z0-9_.]+)( *[,}])/, `$1${scale}$3`)
    return lines.join("\n")
  }
  const catchAll = lines.findIndex((l) => l.startsWith('hl.monitor({ output = "",'))
  if (catchAll < 0) throw new Error("no catch-all")
  lines.splice(catchAll + 1, 0, `hl.monitor({ output = "${output}", mode = "preferred", position = "auto", scale = ${scale} })`)
  return lines.join("\n")
}

// Omarchy's toggle flag texts (omarchy-hyprland-monitor-internal{,-mirror}).
const FLAG_MIRROR = (external, internal) =>
  `hl.monitor({ output = "${external}", mode = "preferred", position = "auto", scale = 1, mirror = "${internal}" })\n`
const FLAG_DISABLE = (internal) => `hl.monitor({ output = "${internal}", disabled = true })\n`

// Stub commands for apply.sh. Every call is appended to calls.log; the stub
// hyprctl answers `eval` with $STUB_EVAL_REPLY (default "ok"). The Omarchy
// stubs write and remove the toggle flag files like the real commands do, so
// a sequence of clicks can be followed through the flags directory. The
// notify-send stub only records its call. opts.monitorsLua, when a string,
// is written as the fake home's monitors.lua (next to the target); without it
// there is no monitors.lua, so apply.sh has nothing to wire.
function stubEnv(opts = {}) {
  const root = tmpdir("stub")
  const bin = path.join(root, "bin")
  fs.mkdirSync(bin)
  const log = path.join(root, "calls.log")
  const toggles = path.join(root, "toggles")
  fs.mkdirSync(toggles)
  // A stub named in $STUB_FAIL_CMD logs its call, prints "<name>: boom" to
  // stderr and exits 1, like an Omarchy command that refuses.
  const stub = (name, body) => {
    const file = path.join(bin, name)
    fs.writeFileSync(file, "#!/bin/bash\nprintf '%s' \"" + name + "\" >>\"" + log + "\"\nfor a in \"$@\"; do printf ' [%s]' \"$a\" >>\"" + log + "\"; done\necho >>\"" + log + "\"\n" +
      "[[ \"${STUB_FAIL_CMD:-}\" == \"" + name + "\" ]] && { echo \"" + name + ": boom\" >&2; exit 1; }\n" + (body || ""))
    fs.chmodSync(file, 0o755)
    return file
  }
  const hyprctl = stub("hyprctl", "echo \"${STUB_EVAL_REPLY:-ok}\"\n")
  const writeFlag = (name, text) => `cat >"${toggles}/${name}.lua" <<'FLAG'\n${text}FLAG\n`
  const internal = stub("omarchy-hyprland-monitor-internal",
    `case "$1" in\noff) ${writeFlag("internal-monitor-disable", FLAG_DISABLE("eDP-1"))};;\non) rm -f "${toggles}/internal-monitor-disable.lua" ;;\nesac\n`)
  const mirror = stub("omarchy-hyprland-monitor-internal-mirror",
    `case "$1" in\non) rm -f "${toggles}/internal-monitor-disable.lua"\n${writeFlag("internal-monitor-mirror", FLAG_MIRROR("DP-1", "eDP-1"))};;\noff) rm -f "${toggles}/internal-monitor-mirror.lua" ;;\nesac\n`)
  const notify = stub("notify-send")
  for (const flag of opts.flags || []) fs.writeFileSync(path.join(toggles, flag + ".lua"), "-- flag\n")
  const target = path.join(root, "hypr", "display-arrangement.lua")
  if (opts.existing !== undefined) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, opts.existing)
  }
  const monitorsLua = path.join(root, "hypr", "monitors.lua")
  if (typeof opts.monitorsLua === "string") {
    fs.mkdirSync(path.dirname(monitorsLua), { recursive: true })
    fs.writeFileSync(monitorsLua, opts.monitorsLua)
  }
  const env = {
    // Stubs first on PATH, and no Hyprland instance to reach, so nothing in
    // a test can touch the live compositor even if a stub were skipped.
    PATH: bin + ":" + process.env.PATH,
    HOME: root,
    DISPLAY_ARRANGER_HYPRCTL: hyprctl,
    DISPLAY_ARRANGER_INTERNAL_CMD: internal,
    DISPLAY_ARRANGER_MIRROR_CMD: mirror,
    DISPLAY_ARRANGER_TARGET: target,
    DISPLAY_ARRANGER_TOGGLES_DIR: toggles,
    DISPLAY_ARRANGER_MONITORS_LUA: monitorsLua,
    DISPLAY_ARRANGER_NOTIFY_CMD: notify,
    DISPLAY_ARRANGER_LOG_DIR: path.join(root, "log")
  }
  if (opts.evalReply) env.STUB_EVAL_REPLY = opts.evalReply
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [])
  const flagsNow = () => {
    const out = {}
    for (const f of fs.readdirSync(toggles).sort()) out[f.replace(/\.lua$/, "")] = fs.readFileSync(path.join(toggles, f), "utf8")
    return out
  }
  const applyLog = () => {
    const file = path.join(root, "log", "apply.log")
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  }
  return { root, env, target, toggles, monitorsLua, calls, flags: flagsNow, log: applyLog }
}

function runApply(stub, args, extraEnv = {}, script = path.join(VERSION_DIR, "apply.sh")) {
  return spawnSync("bash", [script, ...args], {
    env: Object.assign({}, stub.env, extraEnv),
    encoding: "utf8"
  })
}

// Rectangles of the enabled displays of a tile at given sizes.
function rects(spec, sizes, mode) {
  const pos = Model.place(spec, sizes)
  return Object.keys(pos)
    .filter((k) => !(mode === "laptop-off" && k === spec.laptop))
    .map((k) => ({ name: k, x: pos[k].x, y: pos[k].y, w: sizes[k].w, h: sizes[k].h }))
}

module.exports = {
  PLUGIN, VERSION_DIR, Model, LIVE, MONITORS_LUA, WIRED, WIRED_PATH,
  DESC_742, DESC_519, KEY_742, KEY_519,
  FLAG_MIRROR, FLAG_DISABLE,
  laptop, northwind, displays, configured, tmpdir, runLua, runConfig,
  effectiveRule, layout, overlaps, touches, assertSound, iconScale,
  stubEnv, runApply, rects
}
