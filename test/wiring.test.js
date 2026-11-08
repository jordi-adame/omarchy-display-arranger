// Self-wiring: after apply.sh has written display-arrangement.lua, it makes
// ~/.config/hypr/monitors.lua load that file by appending, once, a comment
// and require("hypr.display-arrangement") at the end (a timestamped backup
// first, then tmp + mv). It never touches monitors.lua otherwise, does
// nothing when the file is missing or not writable, says so in the popup,
// and prints what it would do in a dry run. Stub commands only; nothing
// reaches the live compositor.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { Model, LIVE, MONITORS_LUA, WIRED, configured, stubEnv, runApply, VERSION_DIR } = require("./helpers.js")

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

test("first click: the require line and its comment are appended once, after a timestamped backup", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  fs.chmodSync(stub.monitorsLua, 0o644)
  const res = runApply(stub, args(planFor("right")))
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA + APPENDED)
  assert.equal(fs.statSync(stub.monitorsLua).mode & 0o777, 0o644, "mode kept")
  const bak = backups(stub)
  assert.equal(bak.length, 1, "one backup: " + bak.join(", "))
  assert.equal(fs.readFileSync(path.join(path.dirname(stub.monitorsLua), bak[0]), "utf8"), MONITORS_LUA)
  // The arrangement file was written before the wiring, and the wiring is logged.
  assert.equal(fs.readFileSync(stub.target, "utf8"), planFor("right").luaText)
  assert.match(stub.log(), /wired .*monitors\.lua/)
  // No temp file left beside monitors.lua.
  const leftovers = fs.readdirSync(path.dirname(stub.monitorsLua)).filter((f) => !BACKUP.test(f)).sort()
  assert.deepEqual(leftovers, ["display-arrangement.lua", "monitors.lua"])
})

test("the user is told once: a notice in the popup and one notify-send, after the eval", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  const res = runApply(stub, args(planFor("right")))
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(kinds(stub.calls()), ["hyprctl", "notify-send"])
  const told = notices(res)
  assert.equal(told.length, 1, res.stdout)
  assert.match(told[0], /monitors\.lua/)
  assert.match(told[0], /\.bak\.\d{8}-\d{6}/, "the notice names the backup")
})

test("second click: no second line, no second backup, no notice, and monitors.lua is not rewritten", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  runApply(stub, args(planFor("right")))
  const wired = fs.readFileSync(stub.monitorsLua, "utf8")
  const before = fs.statSync(stub.monitorsLua)
  const res = runApply(stub, args(planFor("above")))
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), wired)
  assert.equal(backups(stub).length, 1)
  assert.deepEqual(notices(res), [])
  assert.equal(kinds(stub.calls()).filter((k) => k === "notify-send").length, 1)
  assert.deepEqual([before.ino, before.mtimeMs], [fs.statSync(stub.monitorsLua).ino, fs.statSync(stub.monitorsLua).mtimeMs], "not replaced")
})

test("an already wired monitors.lua (the fixture) is left alone", () => {
  const stub = stubEnv({ monitorsLua: WIRED })
  const res = runApply(stub, args(planFor("right")))
  assert.equal(res.status, 0, res.stderr)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), WIRED)
  assert.deepEqual(backups(stub), [])
  assert.deepEqual(notices(res), [])
  assert.deepEqual(kinds(stub.calls()), ["hyprctl"])
})

for (const [how, line] of [
  ["single quotes", "require('hypr.display-arrangement')"],
  ["no parentheses", 'require "hypr.display-arrangement"'],
  ["spaces and indentation", '  require ( "hypr.display-arrangement" )'],
  ["a trailing comment", 'require("hypr.display-arrangement") -- arranger']
]) {
  test(`a hand-written require line counts as wired: ${how}`, () => {
    const text = MONITORS_LUA + "\n" + line + "\n"
    const stub = stubEnv({ monitorsLua: text })
    runApply(stub, args(planFor("right")))
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text)
    assert.deepEqual(backups(stub), [])
  })
}

test("a commented-out require line does not count: the line is appended", () => {
  const text = MONITORS_LUA + '-- require("hypr.display-arrangement")\n'
  const stub = stubEnv({ monitorsLua: text })
  runApply(stub, args(planFor("right")))
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text + APPENDED)
  assert.equal(backups(stub).length, 1)
})

test("a file without a trailing newline gets one before the appended lines", () => {
  const text = MONITORS_LUA.replace(/\n+$/, "")
  const stub = stubEnv({ monitorsLua: text })
  runApply(stub, args(planFor("right")))
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), text + "\n" + APPENDED)
})

test("monitors.lua missing: nothing is created, the popup is told, the click still succeeds", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, args(planFor("right")))
  assert.equal(res.status, 0, res.stderr)
  assert.ok(!fs.existsSync(stub.monitorsLua))
  assert.deepEqual(fs.readdirSync(path.dirname(stub.target)), ["display-arrangement.lua"])
  assert.equal(fs.readFileSync(stub.target, "utf8"), planFor("right").luaText, "the arrangement file is still written")
  const told = notices(res)
  assert.equal(told.length, 1, res.stdout)
  assert.match(told[0], /monitors\.lua/)
  assert.match(told[0], /not found|missing/)
  assert.deepEqual(kinds(stub.calls()), ["hyprctl"], "no notify-send for a missing file")
})

test("monitors.lua not writable: left alone, no backup, the popup is told", { skip: isRoot && "root can write anything" }, () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  fs.chmodSync(stub.monitorsLua, 0o444)
  try {
    const res = runApply(stub, args(planFor("right")))
    assert.equal(res.status, 0, res.stderr)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
    assert.deepEqual(backups(stub), [])
    const told = notices(res)
    assert.equal(told.length, 1, res.stdout)
    assert.match(told[0], /not writable/)
    assert.deepEqual(kinds(stub.calls()), ["hyprctl"])
  } finally {
    fs.chmodSync(stub.monitorsLua, 0o644)
  }
})

test("the hypr directory not writable: monitors.lua left alone, the popup is told", { skip: isRoot && "root can write anything" }, () => {
  // The arrangement file must already exist: writing it needs the directory too.
  const stub = stubEnv({ monitorsLua: MONITORS_LUA, existing: "old\n" })
  const dir = path.dirname(stub.monitorsLua)
  fs.chmodSync(dir, 0o555)
  try {
    const res = runApply(stub, args(planFor("right")))
    // The arrangement file cannot be replaced either (tmp + mv needs the
    // directory), so the click fails before the wiring; monitors.lua is untouched.
    assert.notEqual(res.status, 0)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
    assert.deepEqual(backups(stub), [])
  } finally {
    fs.chmodSync(dir, 0o755)
  }
})

test("dry run: prints the backup and the lines it would append, changes nothing", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA, existing: "old\n" })
  const res = runApply(stub, ["--dry-run", ...args(planFor("right"))])
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
  const res = runApply(stub, ["--dry-run", ...args(planFor("right"))])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /dry-run: .*monitors\.lua already requires hypr\.display-arrangement/)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), WIRED)
})

test("dry run with no monitors.lua says so and creates nothing", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, ["--dry-run", ...args(planFor("right"))])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /notice: monitors\.lua not found/)
  assert.ok(!fs.existsSync(stub.monitorsLua))
})

test("an eval error leaves monitors.lua unwired", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA, existing: "old\n", evalReply: "error: bad rule" })
  const res = runApply(stub, args(planFor("right")))
  assert.notEqual(res.status, 0)
  assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA)
  assert.deepEqual(backups(stub), [])
})

test("laptop off and mirror wire monitors.lua after the write, before Omarchy's toggle", () => {
  for (const [kind, toggle] of [["off", "omarchy-hyprland-monitor-internal off"], ["mirror", "omarchy-hyprland-monitor-internal-mirror on"]]) {
    const stub = stubEnv({ monitorsLua: MONITORS_LUA })
    const res = runApply(stub, args(planFor(kind)))
    assert.equal(res.status, 0, res.stderr)
    assert.equal(fs.readFileSync(stub.monitorsLua, "utf8"), MONITORS_LUA + APPENDED, kind)
    assert.deepEqual(kinds(stub.calls()), ["notify-send", toggle], kind)
    const log = stub.log().split("\n")
    const wrote = log.findIndex((l) => l.includes("wrote "))
    const wired = log.findIndex((l) => l.includes("wired "))
    const ran = log.findIndex((l) => l.includes("run: ") && l.includes("omarchy-hyprland-monitor-internal"))
    assert.ok(wrote >= 0 && wired > wrote && ran > wired, kind + ": " + log.join(" | "))
  }
})

test("the uninstall commands in the README remove exactly what was appended", () => {
  const stub = stubEnv({ monitorsLua: MONITORS_LUA })
  runApply(stub, args(planFor("right")))
  const wired = fs.readFileSync(stub.monitorsLua, "utf8")
  // README, "Uninstall": sed -i -e '/^-- Display arrangement from the jordi-adame.display-arranger bar widget/d' -e '/^require("hypr.display-arrangement")$/d'
  const restored = wired.split("\n")
    .filter((l) => !/^-- Display arrangement from the jordi-adame\.display-arranger bar widget/.test(l) && !/^require\("hypr\.display-arrangement"\)$/.test(l))
    .join("\n")
  assert.equal(restored, MONITORS_LUA + "\n", "only the blank separator line remains")
})

test("Panel.qml shows the notice line in the popup, apart from the failure text", () => {
  const source = fs.readFileSync(path.join(VERSION_DIR, "Panel.qml"), "utf8")
  assert.match(source, /property string noticeText/)
  // The first "notice: " line of apply.sh's stdout becomes noticeText, in the exit handler.
  const onExited = source.slice(source.indexOf("onExited:"), source.indexOf("BarIconButton {"))
  assert.match(onExited, /"notice: "/)
  assert.match(onExited, /root\.noticeText = /)
  // It is drawn by its own Text, not in the urgent colour used for failures.
  const noticeItem = source.slice(source.indexOf("text: root.noticeText") - 400, source.indexOf("text: root.noticeText") + 300)
  assert.match(noticeItem, /visible: root\.noticeText !== ""/)
  assert.doesNotMatch(noticeItem, /Color\.urgent/)
})
