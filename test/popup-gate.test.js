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
