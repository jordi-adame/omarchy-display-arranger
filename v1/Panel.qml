import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// Bar icon with a popup of arrangement tiles, one per arrangement possible
// with the displays connected now. A tile click applies the arrangement live
// and persists it to ~/.config/hypr/display-arrangement.lua through apply.sh
// (which also holds the dry-run path). The highlighted tile is read from
// `hyprctl monitors all -j`, never from the file, so it always shows what
// Hyprland runs now. Sizes come from the scales monitors.lua configures
// (read on every refresh), not from the live scales, so a mirror or
// laptop-off toggle cannot distort the tiles or the plan.
//
// Mirror and laptop-off take an output away. While this popup is open,
// Omarchy's KeyboardPanel keeps a transparent "dismiss twin" window on every
// other output; when the output under the popup goes, Qt moves the popup
// window to the surviving output, the twin for the vanished output is made
// visible again and Quickshell re-creates it on the screen Qt is deleting.
// That window comes back as a plain xdg toplevel and Qt crashes on its first
// configure (QWaylandWindow::setGeometry, null screen; see the README). So those
// two tiles close the popup first and run the toggle only once the popup
// window has unmapped. Arrangement changes that keep every output (the other
// tiles) run at once, as before.
Panel {
  id: root
  moduleName: "jordi-adame.display-arranger"
  ipcTarget: "jordi-adame.display-arranger"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Translator for Model.js and the texts below: the catalog string, or the
  // English default when no catalog has the key.
  function tr(key, english) {
    return strings.t(key, english)
  }

  readonly property string scriptPath: decodeURIComponent(String(Qt.resolvedUrl("apply.sh")).replace(/^file:\/\//, ""))

  readonly property string monitorsLuaPath: Quickshell.env("HOME") + "/.config/hypr/monitors.lua"

  property string monitorsJson: "[]"
  property string monitorsLuaText: ""
  readonly property var displays: Model.configuredDisplays(Model.parseMonitors(monitorsJson), monitorsLuaText)
  readonly property var tiles: Model.catalog(displays, root.tr)
  readonly property string currentId: Model.currentTileId(tiles, displays)
  readonly property string emptyReason: Model.emptyReason(displays)

  // Keyboard and mouse share one cursor over the tiles: 0..tiles.length-1.
  property int cursorIndex: -1
  property bool cursorActive: false
  property string pendingId: ""
  property string statusText: ""
  // What apply.sh reports without failing (a "notice:" line): the monitors.lua
  // wiring it did, or why it did not touch the file.
  property string noticeText: ""
  // A plan waiting for the popup to unmap (mirror and laptop-off only).
  property var deferredPlan: null
  readonly property bool busy: applyProc.running || deferredPlan !== null
  readonly property int columns: 3

  function refresh() {
    if (!monitorsLuaProc.running) monitorsLuaProc.running = true
    if (!monitorsProc.running) monitorsProc.running = true
  }

  function moveCursor(dx, dy) {
    if (tiles.length === 0) return
    if (!cursorActive || cursorIndex < 0) {
      cursorActive = true
      cursorIndex = Math.max(0, tiles.indexOf(tiles.filter(function(t) { return t.id === root.currentId })[0]))
      return
    }
    var next = cursorIndex
    if (dx !== 0) {
      next = cursorIndex + dx
    } else if (dy !== 0) {
      next = cursorIndex + dy * columns
      if (next >= tiles.length || next < 0) next = cursorIndex
    }
    cursorIndex = Math.max(0, Math.min(tiles.length - 1, next))
  }

  function activateCursor() {
    if (cursorIndex >= 0 && cursorIndex < tiles.length) choose(cursorIndex)
  }

  function choose(index) {
    if (busy || index < 0 || index >= tiles.length) return
    var tile = tiles[index]
    var plan = Model.applyPlan(tile, displays, { writtenAt: new Date().toISOString() })
    root.pendingId = tile.id
    root.statusText = ""
    root.noticeText = ""
    if (Model.removesOutput(plan.mode)) {
      // Close first; runDeferred() runs the plan once the window is unmapped.
      root.deferredPlan = plan
      root.close()
      deferTimeout.restart()
      if (!panel.backingWindowVisible) runDeferred()
      return
    }
    runPlan(plan)
  }

  function runPlan(plan) {
    applyProc.popupOpen = root.opened
    applyProc.command = ["bash", root.scriptPath, "apply", plan.mode, plan.luaText, plan.evalExpr, plan.evalExprLidClosed]
    applyProc.running = true
  }

  // Runs the deferred plan when the popup is closed and its window is gone.
  // Reopened meanwhile: close again and keep waiting, never run it open.
  function runDeferred() {
    var plan = root.deferredPlan
    if (!plan) return
    if (root.opened) {
      root.close()
      deferTimeout.restart()
      return
    }
    if (panel.backingWindowVisible && deferTimeout.running) return
    root.deferredPlan = null
    deferTimeout.stop()
    runPlan(plan)
  }

  // The fade-out is 120 ms; a window that has not unmapped after this long
  // no longer protects anything (the popup has been closed for a second, so
  // the twins are gone), and the plan runs.
  Timer {
    id: deferTimeout
    interval: 1000
    onTriggered: root.runDeferred()
  }

  Connections {
    target: panel
    function onBackingWindowVisibleChanged() {
      if (!panel.backingWindowVisible) root.runDeferred()
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Component.onCompleted: refresh()

  onOpenedChanged: {
    if (opened) {
      refresh()
      cursorActive = false
      cursorIndex = -1
      // statusText and noticeText stay: a mirror or laptop-off click reports
      // after the popup has closed, and is read on the next open.
    }
  }

  // Poll only while the popup is open, like Omarchy's Display panel.
  Timer {
    interval: 3000
    running: root.opened
    repeat: true
    onTriggered: root.refresh()
  }

  // monitors.lua first, so the displays are built from the current scales
  // when the monitor snapshot lands. A missing file gives empty text, and the
  // model then uses the live scales (see Model.configuredDisplays).
  Process {
    id: monitorsLuaProc
    command: ["cat", "--", root.monitorsLuaPath]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.monitorsLuaText = String(text || "")
    }
    stderr: StdioCollector { waitForEnd: true }
  }

  Process {
    id: monitorsProc
    command: ["hyprctl", "monitors", "all", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "").trim()
        if (raw !== "") root.monitorsJson = raw
      }
    }
  }

  Process {
    id: applyProc
    // Told to apply.sh, which refuses mirror and laptop-off while "1".
    property bool popupOpen: false
    environment: ({ DISPLAY_ARRANGER_POPUP_OPEN: applyProc.popupOpen ? "1" : "0" })
    stdout: StdioCollector { id: applyOut; waitForEnd: true }
    stderr: StdioCollector { id: applyErr; waitForEnd: true }
    onExited: function(exitCode, exitStatus) {
      var err = String(applyErr.text || "").trim()
      var out = String(applyOut.text || "")
      if (exitCode !== 0) root.statusText = err !== "" ? err.split("\n")[0] : root.tr("status.failed", "Could not apply the arrangement")
      else if (out.indexOf("dry-run:") >= 0) root.statusText = root.tr("status.dryRun", "Dry run: nothing applied (see the apply log)")
      var notices = out.split("\n").filter(function(l) { return l.indexOf("notice: ") === 0 })
      root.noticeText = notices.length > 0 ? notices[0].slice("notice: ".length) : ""
      root.pendingId = ""
      root.refresh()
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // nf-md-view_grid
    text: String.fromCodePoint(0xF0570)
    tooltipText: root.tr("tooltip", "Display arrangement")
    onPressed: function(b) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    // Style.space(500): 583 px at shell base-size 14 (a 547 px grid), between
    // Omarchy's weather (480) and clock (560) popups. At 400 (a 431 px grid)
    // the external's rectangle in the above, left, right and below tiles is
    // 50x27 and a nine-letter brand shrinks to 8 px there. At 500 those
    // rectangles are 65x36 and the brand shows at 11 px (12 at laptop scale
    // 1.25), never elided; see test/captions.test.js.
    // fittedContentWidth clamps to the screen minus the margins, so a narrow
    // screen gets a narrower card and the grid reflows (TileGrid follows the
    // column width).
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: if (root.cursorActive) root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        Item {
          width: parent.width
          implicitHeight: header.implicitHeight

          PanelSectionHeader {
            id: header
            anchors.left: parent.left
            text: root.tr("title", "ARRANGEMENT")
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }
        }

        TileGrid {
          id: tileGrid
          width: parent.width
          visible: root.tiles.length > 0
          height: implicitHeight
          tiles: root.tiles
          currentId: root.pendingId !== "" ? root.pendingId : root.currentId
          cursorIndex: root.cursorActive ? root.cursorIndex : -1
          busy: root.busy
          columns: root.columns
          spacing: Style.space(8)
          radius: Style.cornerRadius
          foreground: root.bar.foreground
          accent: Commons.Color.accent
          background: Commons.Color.popups.background
          fontFamily: root.bar.fontFamily
          tooltipComponent: Component { PanelToolTip { } }
          onActivated: function(index) { root.choose(index) }
          onHoveredIndex: function(index) {
            root.cursorActive = true
            root.cursorIndex = index
          }
        }

        // What the tile under the cursor (or the current one) does.
        Text {
          width: parent.width
          visible: root.tiles.length > 0
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: {
            if (root.deferredPlan) return root.tr("status.closing", "Closing the popup first…")
            var i = root.cursorActive ? root.cursorIndex : -1
            if (i >= 0 && i < root.tiles.length) return root.tiles[i].label
            for (var j = 0; j < root.tiles.length; j++)
              if (root.tiles[j].id === root.currentId) return root.tiles[j].label
            return root.tr("noMatch", "The current arrangement has no tile")
          }
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }

        Text {
          width: parent.width
          visible: root.tiles.length === 0
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: root.emptyReason === "laptop-only" ? root.tr("note.laptopOnly", "Only the laptop display is connected. Connect a display to arrange it.")
            : (root.emptyReason === "too-many" ? root.tr("note.tooMany", "More than two external displays are connected. The tiles cover two at most.")
              : root.tr("note.single", "Only one display is connected."))
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.body
        }

        // What the last click reported: monitors.lua was wired (or why it was not).
        Text {
          width: parent.width
          visible: root.noticeText !== ""
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: root.noticeText
          color: Qt.darker(root.bar.foreground, 1.4)
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }

        Text {
          width: parent.width
          visible: root.statusText !== ""
          wrapMode: Text.Wrap
          textFormat: Text.PlainText
          text: root.statusText
          color: Commons.Color.urgent
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
