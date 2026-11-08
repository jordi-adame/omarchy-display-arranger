// apply.sh against stub commands: no real hyprctl or Omarchy command is ever
// reached (stubs first on PATH, every command overridden,
// no HYPRLAND_INSTANCE_SIGNATURE).
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { Model, LIVE, MONITORS_LUA, configured, stubEnv, runApply, tmpdir, VERSION_DIR } = require("./helpers.js")

delete process.env.HYPRLAND_INSTANCE_SIGNATURE

const live = configured(LIVE, MONITORS_LUA)
const tiles = Model.catalog(live)
const planFor = (kind) => Model.applyPlan(tiles.find((t) => t.kind === kind), live, { writtenAt: "2026-11-07T22:00:00Z" })
const args = (plan) => ["apply", plan.mode, plan.luaText, plan.evalExpr, plan.evalExprLidClosed]
const kinds = (calls) => calls.map((c) => c.split(" ")[0].split("/").pop() + (c.includes("[eval]") ? " eval" : "") +
  (/ \[(on|off)\]$/.test(c) ? " " + c.match(/ \[(on|off)\]$/)[1] : ""))

test("normal: eval live first, then write the file atomically", () => {
  const stub = stubEnv({ existing: "old\n" })
  const plan = planFor("right")
  const res = runApply(stub, args(plan))
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(kinds(stub.calls()), ["hyprctl eval"])
  assert.ok(stub.calls()[0].includes("[" + plan.evalExpr + "]"))
  assert.equal(fs.readFileSync(stub.target, "utf8"), plan.luaText)
  const leftovers = fs.readdirSync(path.dirname(stub.target)).filter((f) => f !== "display-arrangement.lua")
  assert.deepEqual(leftovers, [], "no temp file left behind")
})

test("normal: Hyprland rejects the rules, the file stays as it was", () => {
  const stub = stubEnv({ existing: "old\n", evalReply: "error: bad rule" })
  const res = runApply(stub, args(planFor("right")))
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /bad rule/)
  assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
})

test("normal: Omarchy's laptop-off and mirror flags are lifted after the write, no eval", () => {
  const stub = stubEnv({ flags: ["internal-monitor-disable", "internal-monitor-mirror"] })
  const res = runApply(stub, args(planFor("above")))
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(kinds(stub.calls()), ["omarchy-hyprland-monitor-internal-mirror off", "omarchy-hyprland-monitor-internal on"])
  assert.ok(fs.existsSync(stub.target), "file written before the reloads")
  assert.deepEqual(Object.keys(stub.flags()), [], "both flags gone")
  // The write happened first: the log records it before the toggle commands.
  const log = fs.readFileSync(path.join(stub.env.DISPLAY_ARRANGER_LOG_DIR, "apply.log"), "utf8").split("\n")
  const wrote = log.findIndex((l) => l.includes("wrote "))
  const lifted = log.findIndex((l) => l.includes("monitor-internal-mirror off"))
  assert.ok(wrote >= 0 && lifted > wrote, "write logged before the toggle: " + log.join(" | "))
})

test("a failing Omarchy toggle fails the click: mirror off refused, nothing else runs", () => {
  const stub = stubEnv({ flags: ["internal-monitor-disable", "internal-monitor-mirror"] })
  const res = runApply(stub, args(planFor("above")), { STUB_FAIL_CMD: "omarchy-hyprland-monitor-internal-mirror" })
  assert.notEqual(res.status, 0, "exit status reports the failure")
  assert.match(res.stderr, /omarchy-hyprland-monitor-internal-mirror off failed: .*boom/)
  assert.deepEqual(kinds(stub.calls()), ["omarchy-hyprland-monitor-internal-mirror off"], "the laptop toggle is not attempted")
  assert.deepEqual(Object.keys(stub.flags()), ["internal-monitor-disable", "internal-monitor-mirror"], "flags untouched by the failing stub")
  assert.match(stub.log(), /error: .*mirror off failed/)
})

test("a failing Omarchy toggle fails the click: laptop off and mirror on", () => {
  for (const [kind, cmd] of [["off", "omarchy-hyprland-monitor-internal"], ["mirror", "omarchy-hyprland-monitor-internal-mirror"]]) {
    const stub = stubEnv()
    const res = runApply(stub, args(planFor(kind)), { STUB_FAIL_CMD: cmd })
    assert.notEqual(res.status, 0, kind)
    assert.match(res.stderr, new RegExp(cmd + " \\w+ failed: .*boom"), kind)
  }
})

test("normal with the lid shut (clamshell flag): the laptop keeps its state", () => {
  const stub = stubEnv({ flags: ["internal-monitor-clamshell"] })
  const plan = planFor("above")
  const res = runApply(stub, args(plan))
  assert.equal(res.status, 0, res.stderr)
  assert.ok(stub.calls()[0].includes("[" + plan.evalExprLidClosed + "]"))
})

test("laptop off: write, then Omarchy's internal off (writes the disable flag)", () => {
  const stub = stubEnv()
  const res = runApply(stub, args(planFor("off")))
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(kinds(stub.calls()), ["omarchy-hyprland-monitor-internal off"])
  assert.ok(fs.existsSync(stub.target))
  assert.deepEqual(Object.keys(stub.flags()), ["internal-monitor-disable"])
})

test("laptop off from mirror: mirror off first", () => {
  const stub = stubEnv({ flags: ["internal-monitor-mirror"] })
  runApply(stub, args(planFor("off")))
  assert.deepEqual(kinds(stub.calls()), ["omarchy-hyprland-monitor-internal-mirror off", "omarchy-hyprland-monitor-internal off"])
})

test("laptop off when already off: eval the externals only", () => {
  const stub = stubEnv({ flags: ["internal-monitor-disable"] })
  const plan = planFor("off")
  runApply(stub, args(plan))
  assert.deepEqual(kinds(stub.calls()), ["hyprctl eval"])
  assert.ok(!stub.calls()[0].includes("eDP-1"))
})

test("mirror: write, then Omarchy's mirror on (writes the mirror flag)", () => {
  const stub = stubEnv()
  runApply(stub, args(planFor("mirror")))
  assert.deepEqual(kinds(stub.calls()), ["omarchy-hyprland-monitor-internal-mirror on"])
  assert.ok(fs.existsSync(stub.target))
  assert.deepEqual(Object.keys(stub.flags()), ["internal-monitor-mirror"])
})

test("Lua that does not parse is refused", () => {
  const stub = stubEnv({ existing: "old\n" })
  const res = runApply(stub, ["apply", "normal", "local x = ", "hl.monitor({})", ""])
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /does not parse/)
  assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
})

for (const [how, argv, env, marker] of [
  ["--dry-run", ["--dry-run"], {}, false],
  ["DISPLAY_ARRANGER_DRY_RUN=1", [], { DISPLAY_ARRANGER_DRY_RUN: "1" }, false],
  ["a DRY_RUN file", [], {}, true]
]) {
  test(`dry run via ${how}: prints the commands and the file, changes nothing`, () => {
    // The marker is tried on a copy of apply.sh in a temp dir: the test files
    // run in parallel, and a marker next to the real script would turn every
    // other suite's clicks into dry runs while it exists.
    let script = path.join(VERSION_DIR, "apply.sh")
    if (marker) {
      const dir = tmpdir("marker")
      script = path.join(dir, "apply.sh")
      fs.copyFileSync(path.join(VERSION_DIR, "apply.sh"), script)
      fs.writeFileSync(path.join(dir, "DRY_RUN"), "")
    }
    const stub = stubEnv({ existing: "old\n" })
    const plan = planFor("right")
    const res = runApply(stub, [...argv, ...args(plan)], env, script)
    assert.equal(res.status, 0, res.stderr)
    assert.deepEqual(stub.calls(), [], "no command ran")
    assert.equal(fs.readFileSync(stub.target, "utf8"), "old\n")
    assert.match(res.stdout, /dry-run: would run: .*hyprctl eval /)
    assert.match(res.stdout, /dry-run: would write .*display-arrangement\.lua \(atomic, tmp \+ mv\):/)
    assert.ok(res.stdout.includes(plan.luaText))
    const log = fs.readFileSync(path.join(stub.env.DISPLAY_ARRANGER_LOG_DIR, "apply.log"), "utf8")
    assert.match(log, /dry-run: would run/)
  })
}

test("dry run of laptop off and mirror names Omarchy's commands", () => {
  const stub = stubEnv()
  assert.match(runApply(stub, ["--dry-run", ...args(planFor("off"))]).stdout, /would run: .*omarchy-hyprland-monitor-internal off/)
  assert.match(runApply(stub, ["--dry-run", ...args(planFor("mirror"))]).stdout, /would run: .*omarchy-hyprland-monitor-internal-mirror on/)
  assert.deepEqual(stub.calls(), [])
})

test("drag is not an action: usage error, nothing run", () => {
  const stub = stubEnv()
  const res = runApply(stub, ["drag"])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /^Usage: apply\.sh /)
  assert.doesNotMatch(res.stderr, /drag/)
  assert.deepEqual(stub.calls(), [])
})

test("unknown action and mode are refused", () => {
  const stub = stubEnv()
  assert.equal(runApply(stub, ["bogus"]).status, 2)
  assert.notEqual(runApply(stub, ["apply", "sideways", "x", "", ""]).status, 0)
  assert.deepEqual(stub.calls(), [])
})
