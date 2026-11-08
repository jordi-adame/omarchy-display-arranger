// Renders the popup card (header, the shipped TileGrid, caption line) with the
// Qt offscreen platform and saves a PNG. No window, no compositor. The display
// data is made up: the laptop and Northwind fixtures from test/helpers.js.
//
//   TMPDIR=<scratch> node tools/render-preview.js <one|two|mirror> <out.png> [--notice]
//
//   one     the laptop and one external, "above" being the current arrangement
//   two     the laptop and two identical externals, "one above, one right" current
//   mirror  the laptop and one external, mirroring, so the mirror tile is current
//   --notice  adds the consent notice row (Panel.qml's text and buttons, drawn
//             here in plain QtQuick in place of the shell's Button)
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { VERSION_DIR, laptop, northwind, WIRED, tmpdir } = require(path.resolve(__dirname, "..", "test", "helpers.js"))

const which = process.argv[2]
const out = path.resolve(process.argv[3] || "")
const withNotice = process.argv.includes("--notice")
if (!["one", "two", "mirror"].includes(which) || !process.argv[3] || process.argv.slice(4).some((a) => a !== "--notice")) {
  console.error("usage: render-preview.js <one|two|mirror> <out.png> [--notice]")
  process.exit(2)
}
const STRINGS = JSON.parse(fs.readFileSync(path.join(VERSION_DIR, "i18n", "en.json"), "utf8"))
const live = northwind("DEMO00000742", { x: 0, y: -1080 })
const monitors = which === "two" ? [laptop(), live, northwind("DEMO00000519", { x: 1920, y: 0 })]
  : which === "mirror" ? [laptop(), northwind("DEMO00000742", { scale: 1, mirrorOf: "eDP-1", x: 1920, y: 0 })]
  : [laptop(), live]

// Shell base-size 14 (Omarchy's default is 12): Style.space(500) card = 583,
// padding 16, border 2, grid 547, spacing 9, column spacing 14, caption font
// 12, header font 12.
const CARD = 583, PAD = 16, BORDER = 2, GRID = 547, SPACING = 9, COL = 14
const dir = tmpdir("preview")
const qml = `
import QtQuick
import "file://${VERSION_DIR}" as Plugin
import "file://${VERSION_DIR}/Model.js" as Model

Rectangle {
  id: root
  // A dark popup palette, close to Omarchy's default theme.
  color: "#1e1e2e"
  width: ${CARD} + 24
  height: card.height + 24
  readonly property var displays: Model.configuredDisplays(Model.parseMonitors(${JSON.stringify(JSON.stringify(monitors))}), ${JSON.stringify(WIRED)})
  readonly property var tiles: Model.catalog(displays)
  readonly property string currentId: Model.currentTileId(tiles, displays)

  Rectangle {
    id: card
    x: 12; y: 12
    width: ${CARD}
    height: column.implicitHeight + 2 * (${PAD} + ${BORDER})
    color: "#1e1e2e"
    border.width: ${BORDER}
    border.color: "#45475a"
    radius: 8

    Column {
      id: column
      x: ${PAD} + ${BORDER}; y: ${PAD} + ${BORDER}
      width: ${GRID}
      spacing: ${COL}

      Text {
        text: "ARRANGEMENT"
        color: "#cdd6f4"
        font.family: "monospace"
        font.pixelSize: 12
        font.bold: true
      }

      Plugin.TileGrid {
        id: grid
        width: ${GRID}
        height: implicitHeight
        tiles: root.tiles
        currentId: root.currentId
        spacing: ${SPACING}
        radius: 8
        fontFamily: "monospace"
      }

      Text {
        width: parent.width
        elide: Text.ElideRight
        text: {
          for (var j = 0; j < root.tiles.length; j++)
            if (root.tiles[j].id === root.currentId) return root.tiles[j].label
          return "The current arrangement has no tile"
        }
        color: Qt.darker("#cdd6f4", 1.4)
        font.family: "monospace"
        font.pixelSize: 12
      }

      // The consent notice as Panel.qml lays it out: caption text left, two
      // small bordered buttons right (the shell's Button at rest).
      Item {
        id: consent
        width: parent.width
        visible: ${withNotice}
        implicitHeight: visible ? Math.max(consentText.implicitHeight, consentButtons.implicitHeight) : 0
        height: implicitHeight

        Text {
          id: consentText
          anchors.left: parent.left
          anchors.right: consentButtons.left
          anchors.rightMargin: 9
          anchors.verticalCenter: parent.verticalCenter
          wrapMode: Text.Wrap
          text: ${JSON.stringify(STRINGS["wire.offer"])}
          color: Qt.darker("#cdd6f4", 1.4)
          font.family: "monospace"
          font.pixelSize: 12
        }

        Row {
          id: consentButtons
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: 7

          Repeater {
            model: [${JSON.stringify(STRINGS["wire.yes"])}, ${JSON.stringify(STRINGS["wire.notNow"])}]
            Rectangle {
              required property string modelData
              width: buttonLabel.implicitWidth + 2 * 9 + 2
              height: buttonLabel.implicitHeight + 2 * 2 + 2
              radius: 8
              color: "transparent"
              border.width: 1
              border.color: Qt.rgba(0xcd / 255, 0xd6 / 255, 0xf4 / 255, 0.38)
              Text {
                id: buttonLabel
                anchors.centerIn: parent
                text: parent.modelData
                color: "#cdd6f4"
                font.family: "monospace"
                font.pixelSize: 12
              }
            }
          }
        }
      }
    }
  }

  Timer {
    interval: 300
    running: true
    onTriggered: {
      root.grabToImage(function(result) {
        var ok = result.saveToFile(${JSON.stringify(out)})
        console.log("PREVIEW " + JSON.stringify({ ok: ok, card: [card.width, card.height], grid: [grid.width, grid.implicitHeight], tile: [grid.tileWidth, grid.tileHeight], current: root.currentId, tiles: root.tiles.length, notice: consent.visible ? [consentText.lineCount, consentButtons.width] : null }))
        Qt.quit()
      })
    }
  }
}
`
const file = path.join(dir, "preview.qml")
fs.writeFileSync(file, qml)
const QML = ["/usr/lib/qt6/bin/qml", "/usr/bin/qml6", "/usr/bin/qml"].find((p) => fs.existsSync(p))
if (!QML) { console.error("qml runtime not found (qt6-declarative)"); process.exit(1) }
const res = spawnSync(QML, [file], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || dir, LANG: "C.UTF-8",
    QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "software", QT_FORCE_STDERR_LOGGING: "1" },
  encoding: "utf8", timeout: 60000
})
const line = (res.stderr + "\n" + res.stdout).split("\n").find((l) => l.includes("PREVIEW "))
if (!line) { console.error(res.stderr, res.stdout); process.exit(1) }
console.log(line.slice(line.indexOf("PREVIEW ")))
