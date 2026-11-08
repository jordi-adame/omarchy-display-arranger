// Wiring: `apply.sh wire` makes ~/.config/hypr/monitors.lua load the
// arrangement file by appending, once, a comment and
// require("hypr.display-arrangement") at the end (a timestamped backup first,
// then tmp + mv). It runs only when the popup's consent notice is answered
// Yes; `apply` never touches monitors.lua. `wire` leaves the file alone when
// it is missing, not writable or already requires the module, and when no
// arrangement file exists yet (requiring a missing file is a config error);
// it says so in the popup and prints what it would do in a dry run. Stub
// commands only; nothing reaches the live compositor.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { Model, LIVE, MONITORS_LUA, WIRED, configured, stubEnv, runApply } = require("./helpers.js")

delete process.env.HYPRLAND_INSTANCE_SIGNATURE

const live = configured(LIVE, MONITORS_LUA)
const tiles = Model.catalog(live)
const planFor = (kind) => Model.applyPlan(tiles.find((t) => t.kind === kind), live, { writtenAt: "2026-11-07T22:00:00Z" })
const args = (plan) => ["apply", plan.mode, plan.luaText, plan.evalExpr, plan.evalExprLidClosed]
const kinds = (calls) => calls.map((c) => c.split(" ")[0].split("/").pop() + (/ \[(on|off)\]$/.test(c) ? " " + c.match(/ \[(on|off)\]$/)[1] : ""))

const COMMENT = "-- Display arrangement from the jordi-adame.display-arranger bar widget. Keep this the last line."
const REQUIRE = 'require("hypr.display-arrangement")'
const APPENDED = "\n" + COMMENT + "\n" + REQUIRE + "\n"
const BACKUP = /^monitors\.lua\.bak\.\d{8}-\d{6}$/
const backups = (stub) => fs.readdirSync(path.dirname(stub.monitorsLua)).filter((f) => BACKUP.test(f)).sort()
const notices = (res) => res.stdout.split("\n").filter((l) => l.startsWith("notice: "))
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
// A machine after a first click: the arrangement file exists, monitors.lua is unwired.
const clicked = (over = {}) => stubEnv(Object.assign({ monitorsLua: MONITORS_LUA, existing: planFor("right").luaText }, over))

test("wire: the require line and its comment are appended once, after a timestamped backup", () => {
  const stub = clicked()
  fs.chmodSync(stub.monitorsLua, 0o644)
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA + APPENDED)
  assert.equal(fs.statSync(stub.monitorsLua).mode & 0o777, 0o644, "mode kept")
  const bak = backups(stub)
  assert.equal(bak.length, 1, "one backup: " + bak.join(", "))
  assert.equal(fs.readFileSync(path.join(path.dirname(stub.monitorsLua), bak[0]), "utf8"), MONITORS_LUA)
  assert.equal(fs.readFileSync(stub.target, "utf8"), planFor("right").luaText, "the arrangement file is left as it was")
  assert.match(stub.log(), /wired .*monitors\.lua/)
  // No temp file left beside monitors.lua.
  const leftovers = fs.readdirSync(path.dirname(stub.monitorsLua)).filter((f) => !BACKUP.test(f)).sort()
  assert.deepEqual(leftovers, ["display-arrangement.lua", "monitors.lua"])
})

test("wire: the user is told once, a notice in the popup and one notify-send", () => {
  const stub = clicked()
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(kinds(stub.calls()), ["notify-send"])
  const told = notices(res)
  assert.equal(told.length, 1, res.stdout)
  assert.match(told[0], /monitors\.lua/)
  assert.match(told[0], /\.bak\.\d{8}-\d{6}/, "the notice names the backup")
})

test("a second wire: no second line, no second backup, no notice, and monitors.lua is not rewritten", () => {
  const stub = clicked()
  runApply(stub, ["wire"])
  const wired = fs.readFileSync(stub.monitorsLua, "utf8")
  const before = fs.statSync(stub.monitorsLua)
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), wired)
  assert.equal(backups(stub).length, 1)
  assert.deepEqual(notices(res), [])
  assert.equal(kinds(stub.calls()).filter((k) => k === "notify-send").length, 1)
  assert.deepEqual([before.ino, before.mtimeMs], [fs.statSync(stub.monitorsLua).ino, fs.statSync(stub.monitorsLua).mtimeMs], "not replaced")
})

test("an already wired monitors.lua (the fixture) is left alone", () => {
  const stub = clicked({ monitorsLua: WIRED })
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), WIRED)
  assert.deepEqual(backups(stub), [])
  assert.deepEqual(notices(res), [])
  assert.deepEqual(stub.calls(), [])
})

for (const [how, line] of [
  ["single quotes", "require('hypr.display-arrangement')"],
  ["no parentheses", 'require "hypr.display-arrangement"'],
  ["spaces and indentation", '  require ( "hypr.display-arrangement" )'],
  ["a trailing comment", 'require("hypr.display-arrangement") -- arranger'],
  ["pcall", 'local ok = pcall(require, "hypr.display-arrangement")'],
  ["an assignment", 'local arrangement = require("hypr.display-arrangement")']
]) {
  test(`a hand-written require line counts as wired: ${how}`, () => {
    const text = MONITORS_LUA + "\n" + line + "\n"
    const stub = clicked({ monitorsLua: text })
    runApply(stub, ["wire"])
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text)
    assert.deepEqual(backups(stub), [])
    assert.equal(Model.requiresArrangement(text), true, "the popup's reader agrees: no offer")
  })
}

test("a commented-out require line does not count: the line is appended", () => {
  const text = MONITORS_LUA + '-- require("hypr.display-arrangement")\n-- local x = require("hypr.display-arrangement")\n'
  const stub = clicked({ monitorsLua: text })
  runApply(stub, ["wire"])
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text + APPENDED)
  assert.equal(backups(stub).length, 1)
  assert.equal(Model.requiresArrangement(text), false, "the popup's reader agrees: the offer shows")
})

test("Model.requiresArrangement, the popup's reader, follows the fixtures and what wire appends", () => {
  assert.equal(Model.requiresArrangement(MONITORS_LUA), false)
  assert.equal(Model.requiresArrangement(WIRED), true)
  assert.equal(Model.requiresArrangement(MONITORS_LUA + APPENDED), true)
  assert.equal(Model.requiresArrangement(""), false)
  assert.equal(Model.requiresArrangement(null), false)
  // Another module, or the module name outside a require, is not wired.
  assert.equal(Model.requiresArrangement(MONITORS_LUA + 'require("hypr.other")\n'), false)
  assert.equal(Model.requiresArrangement(MONITORS_LUA + 'local name = "hypr.display-arrangement"\n'), false)
})

test("a file without a trailing newline gets one before the appended lines", () => {
  const text = MONITORS_LUA.replace(/\n+$/, "")
  const stub = clicked({ monitorsLua: text })
  runApply(stub, ["wire"])
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text + "\n" + APPENDED)
})

test("monitors.lua missing: nothing is created, the popup is told, wire still exits 0", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.ok(!fs.existsSync(stub.monitorsLua))
  assert.deepEqual(fs.readdirSync(path.dirname(stub.target)), ["display-arrangement.lua"])
  const told = notices(res)
  assert.equal(told.length, 1, res.stdout)
  assert.match(told[0], /monitors\.lua/)
  assert.match(told[0], /not found|missing/)
  assert.deepEqual(stub.calls(), [], "no notify-send for a missing file")
})

test("no arrangement file yet: monitors.lua is left alone and the popup is told to click a tile first", () => {
  // The require line would load a missing file, which Hyprland reports as a config error.
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  const res = runApply(stub, ["wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
  assert.deepEqual(backups(stub), [])
  const told = notices(res)
  assert.equal(told.length, 1, res.stdout)
  assert.match(told[0], /click a tile first/)
  assert.deepEqual(stub.calls(), [])
})

test("monitors.lua not writable: left alone, no backup, the popup is told", { skip: isRoot && "root can write anything" }, () => {
  const stub = clicked()
  fs.chmodSync(stub.monitorsLua, 0o444)
  try {
    const res = runApply(stub, ["wire"])
    assert.equal(res.status, 0, res.stderr)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
    assert.deepEqual(backups(stub), [])
    const told = notices(res)
    assert.equal(told.length, 1, res.stdout)
    assert.match(told[0], /not writable/)
    assert.deepEqual(stub.calls(), [])
  } finally {
    fs.chmodSync(stub.monitorsLua, 0o644)
  }
})

test("the hypr directory not writable: monitors.lua left alone (tmp + mv needs the directory), the popup is told", { skip: isRoot && "root can write anything" }, () => {
  const stub = clicked()
  const dir = path.dirname(stub.monitorsLua)
  fs.chmodSync(dir, 0o555)
  try {
    const res = runApply(stub, ["wire"])
    assert.equal(res.status, 0, res.stderr)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
    assert.deepEqual(backups(stub), [])
    assert.match(notices(res)[0] || "", /not writable/)
  } finally {
    fs.chmodSync(dir, 0o755)
  }
})

test("dry run: prints the backup and the lines it would append, changes nothing", () => {
  const stub = clicked({ existing: "old\n" })
  const res = runApply(stub, ["--dry-run", "wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
  assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
  assert.deepEqual(backups(stub), [])
  assert.deepEqual(stub.calls(), [])
  assert.match(res.stdout, /dry-run: would copy .*monitors\.lua to .*monitors\.lua\.bak\.\d{8}-\d{6} and append/)
  assert.ok(res.stdout.includes(COMMENT + "\n" + REQUIRE + "\n"), res.stdout)
})

test("dry run with an already wired file says there is nothing to add", () => {
  const stub = stubEnv({ monitorsLua: WIRED })
  const res = runApply(stub, ["--dry-run", "wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /dry-run: .*monitors\.lua already requires hypr\.display-arrangement/)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), WIRED)
})

test("dry run with no monitors.lua says so and creates nothing", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, ["--dry-run", "wire"])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /notice: monitors\.lua not found/)
  assert.ok(!fs.existsSync(stub.monitorsLua))
})

test("wire takes no further arguments", () => {
  const stub = clicked()
  const res = runApply(stub, ["wire", "now"])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /^Usage: apply\.sh /)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
})

test("apply never touches monitors.lua: normal, laptop off and mirror leave an unwired file alone", () => {
  for (const kind of ["right", "off", "mirror"]) {
    const stub = stubEnv({ monitorsLua: MONITORS_LUA })
    const before = fs.statSync(stub.monitorsLua)
    const res = runApply(stub, args(planFor(kind)))
    assert.equal(res.status, 0, kind + ": " + res.stderr)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA, kind)
    assert.deepEqual([before.ino, before.mtimeMs], [fs.statSync(stub.monitorsLua).ino, fs.statSync(stub.monitorsLua).mtimeMs], kind + ": not replaced")
    assert.deepEqual(backups(stub), [], kind)
    assert.deepEqual(notices(res), [], kind + ": no notice about monitors.lua")
    assert.ok(!kinds(stub.calls()).includes("notify-send"), kind + ": " + stub.calls().join(" | "))
    assert.doesNotMatch(stub.log(), /wired /, kind)
    assert.ok(fs.existsSync(stub.target), kind + ": the arrangement file is still written")
  }
})

test("apply with no monitors.lua, or an already wired one, neither creates nor rewrites it", () => {
  const none = stubEnv({ existing: "old\n" })
  assert.equal(runApply(none, args(planFor("right"))).status, 0)
  assert.ok(!fs.existsSync(none.monitorsLua))
  const wired = stubEnv({ monitorsLua: WIRED })
  const before = fs.statSync(wired.monitorsLua)
  assert.equal(runApply(wired, args(planFor("right"))).status, 0)
  assert.equal(fs.readFileSync(wired.monitorsLua, "utf8"), WIRED)
  assert.equal(fs.statSync(wired.monitorsLua).mtimeMs, before.mtimeMs)
})

test("a dry-run apply says nothing about monitors.lua", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA, existing: "old\n" })
  const res = runApply(stub, ["--dry-run", ...args(planFor("right"))])
  assert.equal(res.status, 0, res.stderr)
  assert.doesNotMatch(res.stdout, /would copy|append|notice:/)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
})

test("the uninstall commands in the README remove exactly what was appended", () => {
  const stub = clicked()
  runApply(stub, ["wire"])
  const wired = fs.readFileSync(stub.monitorsLua, "utf8")
  // README, "Uninstall": sed -i -e '/^-- Display arrangement from the jordi-adame.display-arranger bar widget/d' -e '/^require("hypr.display-arrangement")$/d'
  const restored = wired.split("\n")
    .filter((l) => !/^-- Display arrangement from the jordi-adame\.display-arranger bar widget/.test(l) && !/^require\("hypr\.display-arrangement"\)$/.test(l))
    .join("\n")
  assert.equal(restored, MONITORS_LUA + "\n", "only the blank separator line remains")
})
