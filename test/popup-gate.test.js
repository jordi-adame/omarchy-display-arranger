// The crash guard: mirror and laptop-off take an output away and must never
// run while the popup is open. Panel.qml closes the popup first and waits for
// its window to unmap; apply.sh refuses those modes when told the popup is
// still open. See the README for the crash.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { Model, LIVE, MONITORS_LUA, configured, stubEnv, runApply, VERSION_DIR } = require("./helpers.js")

delete process.env.HYPRLAND_INSTANCE_SIGNATURE

const live = configured(LIVE, MONITORS_LUA)
const tiles = Model.catalog(live)
const planFor = (kind) => Model.applyPlan(tiles.find((t) => t.kind === kind), live, { writtenAt: "2026-11-07T22:00:00Z" })
const args = (plan) => ["apply", plan.mode, plan.luaText, plan.evalExpr, plan.evalExprLidClosed]
const panelSource = fs.readFileSync(path.join(VERSION_DIR, "Panel.qml"), "utf8")

test("apply.sh: mirror is refused while the popup is open; nothing is written or run", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, args(planFor("mirror")), { DISPLAY_ARRANGER_POPUP_OPEN: "1" })
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /popup is still open/)
  assert.deepEqual(stub.calls(), [])
  assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
})

test("apply.sh: laptop-off is refused while the popup is open; nothing is written or run", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, args(planFor("off")), { DISPLAY_ARRANGER_POPUP_OPEN: "1" })
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /popup is still open/)
  assert.deepEqual(stub.calls(), [])
  assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
})

test("apply.sh: with the popup closed, mirror and laptop-off run as before", () => {
  for (const [kind, cmd] of [["mirror", "omarchy-hyprland-monitor-internal-mirror [on]"], ["off", "omarchy-hyprland-monitor-internal [off]"]]) {
    const stub = stubEnv({})
    const res = runApply(stub, args(planFor(kind)), { DISPLAY_ARRANGER_POPUP_OPEN: "0" })
    assert.equal(res.status, 0, res.stderr)
    assert.ok(stub.calls().some((c) => c.endsWith(cmd)), kind + ": " + stub.calls().join(" | "))
    assert.ok(fs.existsSync(stub.target))
  }
})

test("apply.sh: an unset flag behaves as closed (older callers, the dry run)", () => {
  const stub = stubEnv({})
  const res = runApply(stub, args(planFor("mirror")))
  assert.equal(res.status, 0, res.stderr)
})

test("apply.sh: a normal arrangement is never gated by the popup flag", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, args(planFor("above")), { DISPLAY_ARRANGER_POPUP_OPEN: "1" })
  assert.equal(res.status, 0, res.stderr)
  assert.ok(stub.calls()[0].startsWith("hyprctl [eval]"))
})

test("Panel.qml: output-removing tiles close the popup and defer the plan; the others run at once", () => {
  // choose() routes through Model.removesOutput, closes, and lets runDeferred()
  // start the process; runPlan() is the only place the process starts.
  const choose = panelSource.slice(panelSource.indexOf("function choose("), panelSource.indexOf("function runPlan("))
  assert.match(choose, /if \(Model\.removesOutput\(plan\.mode\)\)/)
  assert.match(choose, /root\.deferredPlan = plan/)
  assert.match(choose, /root\.close\(\)/)
  assert.ok(!/applyProc\.running = true/.test(choose), "choose() never starts the process itself")
  assert.equal((panelSource.match(/applyProc\.running = true/g) || []).length, 1, "the process starts in one place")
  const runPlan = panelSource.slice(panelSource.indexOf("function runPlan("), panelSource.indexOf("function runDeferred("))
  assert.match(runPlan, /applyProc\.popupOpen = root\.opened/)
  assert.match(runPlan, /applyProc\.running = true/)
  // runDeferred() refuses to run while the popup is open and closes it again.
  const runDeferred = panelSource.slice(panelSource.indexOf("function runDeferred("), panelSource.indexOf("Timer {", panelSource.indexOf("function runDeferred(")))
  assert.match(runDeferred, /if \(root\.opened\) \{\s*root\.close\(\)/)
  // It waits for the backing window to unmap, with a bounded timeout.
  assert.match(panelSource, /function onBackingWindowVisibleChanged\(\) \{\s*if \(!panel\.backingWindowVisible\) root\.runDeferred\(\)/)
  assert.match(panelSource, /id: deferTimeout\s*interval: 1000/)
  // The state the script checks is passed in its environment.
  assert.match(panelSource, /DISPLAY_ARRANGER_POPUP_OPEN: applyProc\.popupOpen \? "1" : "0"/)
})

test("Panel.qml keeps the status of a deferred run until the next click, not until the next open", () => {
  // Mirror and laptop-off run after the popup has closed, so their status
  // would be wiped by a reset on open before anyone saw it. The wire notice
  // is answered in the open popup and starts afresh on open.
  const onOpened = panelSource.slice(panelSource.indexOf("onOpenedChanged:"), panelSource.indexOf("}", panelSource.indexOf("onOpenedChanged:") + 400))
  assert.doesNotMatch(onOpened, /statusText\s*=/, "open leaves statusText alone")
  assert.match(onOpened, /noticeText = ""/, "open clears the wire notice")
  const choose = panelSource.slice(panelSource.indexOf("function choose("), panelSource.indexOf("function runPlan("))
  assert.match(choose, /root\.statusText = ""/)
  assert.match(choose, /root\.noticeText = ""/)
})

test("Panel.qml takes a new monitor snapshot only when Model.liveSignature changes", () => {
  const poll = panelSource.slice(panelSource.indexOf("id: monitorsProc"), panelSource.indexOf("id: applyProc"))
  assert.match(poll, /Model\.liveSignature\(raw\)/)
  assert.match(poll, /root\.monitorsSignature/)
  assert.match(poll, /if \([^)]*!==[^)]*\)[\s\S]*root\.monitorsJson = raw/)
})

test("Panel.qml reads the previous display-arrangement.lua and hands its fallback scales to the model", () => {
  assert.match(panelSource, /readonly property string arrangementPath: Quickshell\.env\("HOME"\) \+ "\/\.config\/hypr\/display-arrangement\.lua"/)
  assert.match(panelSource, /command: \["cat", "--", root\.arrangementPath\]/)
  assert.match(panelSource, /Model\.configuredDisplays\(Model\.parseMonitors\(monitorsJson\), monitorsLuaText, Model\.parseFallbackScales\(arrangementText\)\)/)
  const refresh = panelSource.slice(panelSource.indexOf("function refresh("), panelSource.indexOf("function moveCursor("))
  assert.match(refresh, /arrangementProc\.running = true/)
})
