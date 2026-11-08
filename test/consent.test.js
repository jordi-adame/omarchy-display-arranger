// The consent notice in Panel.qml: monitors.lua is never edited behind the
// user's back. While the file exists, is writable and lacks the require line
// (Model.requiresArrangement, the same test apply.sh runs), a notice under
// the grid offers to add it with Yes and Not now; Yes runs `apply.sh wire`
// and nothing else, Not now hides the offer until the popup next opens. A
// missing or read-only file shows why, without buttons. The buttons are
// cursor targets after the tiles, so the arrow keys reach them and Enter
// activates them. Panel.qml needs the shell to run, so these read its source.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { VERSION_DIR } = require("./helpers.js")

const panelSource = fs.readFileSync(path.join(VERSION_DIR, "Panel.qml"), "utf8")
const strings = JSON.parse(fs.readFileSync(path.join(VERSION_DIR, "i18n", "en.json"), "utf8"))
const between = (from, to) => {
  const start = panelSource.indexOf(from)
  assert.ok(start >= 0, "found: " + from)
  const end = panelSource.indexOf(to, start + from.length)
  assert.ok(end > start, "found after " + from + ": " + to)
  return panelSource.slice(start, end)
}

test("the offer shows only while the require line is missing from monitors.lua, read like apply.sh reads it", () => {
  assert.match(panelSource, /readonly property bool wired: Model\.requiresArrangement\(monitorsLuaText\)/)
  const offered = between("readonly property bool wireOffered:", "\n")
  assert.match(offered, /!wired/)
  assert.match(offered, /monitorsLuaAccess === "ok"/)
  assert.match(offered, /!wireDismissed/)
  // Not before a first click: the line would load a missing arrangement file.
  assert.match(offered, /arrangementText !== ""/)
  // The offer and its buttons are bound to wireOffered; the row shows for the offer or the reason it cannot be made.
  const consent = between("id: consent", "// The wire reply")
  assert.match(consent, /visible: root\.wireOffered \|\| root\.wireBlocked !== ""/)
  assert.match(consent, /id: consentButtons[\s\S]*?visible: root\.wireOffered/)
  assert.match(consent, /text: root\.wireOffered \? root\.tr\("wire\.offer"/)
})

test("a missing or read-only monitors.lua shows the reason and no buttons; a wired one shows nothing", () => {
  const blocked = between("readonly property string wireBlocked:", "\n\n")
  assert.match(blocked, /wired \? ""/, "nothing once the line is there")
  assert.match(blocked, /monitorsLuaAccess === "missing" \? root\.tr\("wire\.missing"/)
  assert.match(blocked, /monitorsLuaAccess === "readonly" \? root\.tr\("wire\.readOnly"/)
  // The access check is a file test only: the file and its directory (tmp + mv), never a write.
  const access = between("id: accessProc", "stderr:")
  assert.match(access, /-f \$f/)
  assert.match(access, /-w \$f && -w \$\{f%\/\*\}/)
  assert.doesNotMatch(access, />>?\s*\$f|tee|sed -i/)
  for (const key of ["wire.offer", "wire.yes", "wire.notNow", "wire.missing", "wire.readOnly", "status.wireFailed"])
    assert.ok(typeof strings[key] === "string" && strings[key] !== "", key + " in en.json")
  assert.match(strings["wire.missing"], /monitors\.lua not found/)
  assert.match(strings["wire.readOnly"], /not writable/)
})

test("Yes runs apply.sh wire and nothing else; apply never wires", () => {
  const wire = between("function wire()", "function dismissWire()")
  assert.match(wire, /wireProc\.command = \["bash", root\.scriptPath, "wire"\]/)
  assert.equal((panelSource.match(/wireProc\.running = true/g) || []).length, 1, "wire starts in one place")
  const runPlan = between("function runPlan(", "// Yes on the consent notice")
  assert.match(runPlan, /"apply", plan\.mode/)
  assert.doesNotMatch(runPlan, /"wire"/)
  // The apply exit handler no longer reads notices: apply.sh apply prints none.
  const applyExit = between("id: applyProc", "id: wireProc")
  assert.doesNotMatch(applyExit, /notice/)
  // The wire reply is the first "notice: " line, drawn by its own Text, not in the urgent colour.
  const wireExit = between("id: wireProc", "BarIconButton {")
  assert.match(wireExit, /"notice: "/)
  assert.match(wireExit, /root\.noticeText = /)
  const noticeItem = between("// The wire reply", "Commons.Color.urgent")
  assert.match(noticeItem, /visible: root\.noticeText !== ""/)
  assert.match(noticeItem, /text: root\.noticeText/)
})

test("Not now hides the offer for this popup session only", () => {
  assert.match(between("function dismissWire()", "}"), /root\.wireDismissed = true/)
  const onOpened = between("onOpenedChanged:", "// Poll only")
  assert.match(onOpened, /wireDismissed = false/)
  assert.doesNotMatch(panelSource, /FileView|settings\[|setting\(/, "no stored state: the file is the state")
})

test("the buttons are cursor targets after the tiles: arrows reach them, Enter activates them, hover lands on them", () => {
  assert.match(panelSource, /readonly property int cursorCount: tiles\.length \+ \(wireOffered \? 2 : 0\)/)
  const move = between("function moveCursor(", "function activateCursor(")
  assert.match(move, /if \(next >= tiles\.length\) next = wireOffered \? tiles\.length : cursorIndex/, "down past the last row: the Yes button")
  assert.match(move, /if \(cursorIndex >= tiles\.length\)/, "its own moves on the buttons")
  assert.match(move, /Math\.min\(cursorCount - 1, next\)/)
  const activate = between("function activateCursor(", "function choose(")
  assert.match(activate, /if \(cursorIndex === tiles\.length\) wire\(\)/)
  assert.match(activate, /else dismissWire\(\)/)
  assert.match(activate, /if \(!wireOffered\) return/)
  const buttons = between("id: consentButtons", "// The wire reply")
  assert.match(buttons, /hasCursor: root\.cursorActive && root\.cursorIndex === root\.tiles\.length \+ index/)
  assert.match(buttons, /root\.cursorIndex = root\.tiles\.length \+ index/, "hover moves the cursor like a tile does")
  assert.match(buttons, /if \(index === 0\) root\.wire\(\)/)
  assert.match(buttons, /else root\.dismissWire\(\)/)
  // No dropdowns, text selectors or sliders; the shell's own Button, small.
  assert.doesNotMatch(panelSource, /Dropdown|ComboBox|Slider|TextField|SpinBox/)
  assert.match(buttons, /Button \{/)
  assert.match(buttons, /fontSize: Style\.font\.caption/)
})
