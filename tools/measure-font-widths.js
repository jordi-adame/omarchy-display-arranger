// Records test/fixtures/font-widths.json: the TextMetrics advance width of the
// caption strings at every caption size, in the bar font (font.family
// "monospace", bold, as TileGrid.qml measures), with the Qt offscreen
// platform. No window, no compositor. captions.test.js reads the fixture and
// checks that the widths follow the monospace rule it uses for other strings.
//
//   TMPDIR=<scratch> node tools/measure-font-widths.js
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { tmpdir } = require(path.resolve(__dirname, "..", "test", "helpers.js"))

const OUT = path.resolve(__dirname, "..", "test", "fixtures", "font-widths.json")
const IN = "″"
const STRINGS = ["742", "Northwind 15.3" + IN, "Northwind 15" + IN, "Northwind", "Nort…", "Northwind 0742", "0742",
  "Northwind 15.3" + IN + " (0742)", "Laptop", "W", "i"]
const SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14]

const dir = tmpdir("measure")
const qml = `
import QtQuick

Item {
  TextMetrics { id: metrics; font.family: "monospace"; font.bold: true }
  Component.onCompleted: {
    var strings = ${JSON.stringify(STRINGS)}
    var out = { family: metrics.font.family, advanceWidth: {} }
    var sizes = ${JSON.stringify(SIZES)}
    sizes.forEach(function(px) {
      metrics.font.pixelSize = px
      var row = {}
      strings.forEach(function(s) { metrics.text = s; row[s] = metrics.advanceWidth })
      out[String(px)] = row
    })
    out.resolved = fontInfo.fontInfo.family
    console.log("WIDTHS " + JSON.stringify(out))
    Qt.quit()
  }
  Text { id: fontInfo; font.family: "monospace"; font.bold: true; text: "x" }
}
`
const file = path.join(dir, "measure.qml")
fs.writeFileSync(file, qml)
const QML = ["/usr/lib/qt6/bin/qml", "/usr/bin/qml6", "/usr/bin/qml"].find((p) => fs.existsSync(p))
if (!QML) { console.error("qml runtime not found (qt6-declarative)"); process.exit(1) }
const res = spawnSync(QML, [file], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || dir, LANG: "C.UTF-8",
    QT_QPA_PLATFORM: "offscreen", QT_FORCE_STDERR_LOGGING: "1" },
  encoding: "utf8", timeout: 60000
})
const line = (res.stderr + "\n" + res.stdout).split("\n").find((l) => l.includes("WIDTHS "))
if (!line) { console.error(res.stderr, res.stdout); process.exit(1) }
const data = JSON.parse(line.slice(line.indexOf("WIDTHS ") + 7))
const version = spawnSync(QML, ["--version"], { encoding: "utf8" }).stdout.trim()
const advance = {}
for (const px of SIZES) advance[String(px)] = data[String(px)]
const fixture = {
  _comment: `advanceWidth of TextMetrics per font pixel size, recorded by tools/measure-font-widths.js with ${version} (QT_QPA_PLATFORM=offscreen) for font.family monospace, bold, which fontconfig resolved to ${data.resolved} (Omarchy's default bar font). The per-character advance is 0.6 em truncated to 1/64 px (Qt 26.6 fixed point); captions.test.js checks that rule against these numbers and uses it for other strings.`,
  family: data.resolved,
  bold: true,
  advanceWidth: advance
}
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n")
console.log("wrote " + OUT + " (" + data.resolved + ")")
