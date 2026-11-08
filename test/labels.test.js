// Display labels: brand plus diagonal inches, the serial tail only
// when two connected displays would read the same, "Laptop" for the laptop.
const test = require("node:test")
const assert = require("node:assert/strict")
const { Model, laptop, northwind, displays } = require("./helpers.js")

const IN = "\u2033"

test("shortBrand: company suffixes go, with or without a dot or comma", () => {
  assert.equal(Model.shortBrand("Northwind Corporation"), "Northwind")
  assert.equal(Model.shortBrand("Dell Inc."), "Dell")
  assert.equal(Model.shortBrand("Samsung Electric Company"), "Samsung")
  assert.equal(Model.shortBrand("Acer Technologies"), "Acer")
  assert.equal(Model.shortBrand("BenQ Corporation,"), "BenQ")
  assert.equal(Model.shortBrand("Philips Consumer Electronics Co., Ltd."), "Philips Consumer")
  assert.equal(Model.shortBrand("Eizo Nanao Corp"), "Eizo Nanao")
  assert.equal(Model.shortBrand("Siemens AG"), "Siemens")
  assert.equal(Model.shortBrand("LG Display"), "LG Display")
  assert.equal(Model.shortBrand("ASUSTek COMPUTER INC"), "ASUSTek COMPUTER")
  // A make that is only a suffix keeps its one word.
  assert.equal(Model.shortBrand("Corporation"), "Corporation")
  assert.equal(Model.shortBrand(""), "")
  assert.equal(Model.shortBrand(undefined), "")
})

test("diagonalInches: from the physical size in millimetres, one decimal", () => {
  assert.equal(Model.diagonalInches(340, 190), 15.3)
  assert.equal(Model.diagonalInches(300, 190), 14.0)
  assert.equal(Model.diagonalInches(600, 340), 27.2)
  assert.equal(Model.diagonalInches(0, 190), null)
  assert.equal(Model.diagonalInches(340, 0), null)
  assert.equal(Model.diagonalInches(undefined, undefined), null)
  assert.equal(Model.diagonalInches("340", "190"), 15.3)
})

test("baseLabel: brand and size; brand and model without a size; what is there otherwise", () => {
  assert.equal(Model.baseLabel({ make: "Northwind Corporation", model: "NW-1560", physicalWidth: 340, physicalHeight: 190 }), "Northwind 15.3" + IN)
  assert.equal(Model.baseLabel({ make: "Northwind Corporation", model: "NW-1560", physicalWidth: 0, physicalHeight: 0 }), "Northwind NW-1560")
  assert.equal(Model.baseLabel({ make: "Northwind Corporation", model: "", physicalWidth: 0, physicalHeight: 0 }), "Northwind")
  assert.equal(Model.baseLabel({ make: "", model: "NW-1560", physicalWidth: 340, physicalHeight: 190 }), "NW-1560 15.3" + IN)
  assert.equal(Model.baseLabel({ make: "", model: "NW-1560", physicalWidth: 0, physicalHeight: 0 }), "NW-1560")
  assert.equal(Model.baseLabel({ name: "DP-3", make: "", model: "", physicalWidth: 0, physicalHeight: 0 }), "DP-3")
})

test("parse: one external gets brand and size, no serial", () => {
  const d = displays([laptop(), northwind("DEMO00000742")])
  assert.equal(d[1].label, "Northwind 15.3" + IN)
  assert.equal(d[1].shortLabel, "Northwind")
  assert.equal(d[1].tag, "742")
})

test("parse: two identical externals with serials get the last four serial characters", () => {
  const d = displays([laptop(), northwind("DEMO00000742"), northwind("DEMO00000519")])
  const byKey = Object.fromEntries(d.map((x) => [x.name, x]))
  assert.equal(byKey["DP-1"].label, "Northwind 15.3" + IN + " (0742)")
  assert.equal(byKey["DP-1"].shortLabel, "0742")
  assert.equal(byKey["DP-2"].label, "Northwind 15.3" + IN + " (0519)")
  assert.equal(byKey["DP-2"].shortLabel, "0519")
})

test("parse: two identical externals without serials get A and B in connection order", () => {
  const a = { name: "DP-2", description: "Acme Monitor", make: "Acme Corp.", model: "M27", serial: "", physicalWidth: 600, physicalHeight: 340, width: 2560, height: 1440, refreshRate: 60, scale: 1 }
  const b = Object.assign({}, a, { name: "DP-1" })
  const d = displays([laptop(), a, b])
  const byName = Object.fromEntries(d.map((x) => [x.name, x]))
  assert.equal(byName["DP-2"].label, "Acme 27.2" + IN + " A")
  assert.equal(byName["DP-1"].label, "Acme 27.2" + IN + " B")
  assert.deepEqual([byName["DP-2"].shortLabel, byName["DP-1"].shortLabel], ["A", "B"])
})

test("parse: different displays never get a serial tail, even with the same brand", () => {
  const other = northwind("DEMO00000519", { name: "DP-2", description: "Northwind Corporation NW-2400 ABC123", model: "NW-2400", physicalWidth: 530, physicalHeight: 300 })
  const d = displays([laptop(), northwind("DEMO00000742"), other])
  const labels = d.filter((x) => !x.isLaptop).map((x) => x.label).sort()
  assert.deepEqual(labels, ["Northwind 15.3" + IN, "Northwind 24.0" + IN])
})

test("parse: a display without a physical size falls back to brand and model", () => {
  const d = displays([laptop(), northwind("DEMO00000742", { physicalWidth: 0, physicalHeight: 0 })])
  assert.equal(d[1].label, "Northwind NW-1560")
})

test("parse: the laptop is Laptop", () => {
  const d = displays([laptop(), northwind("DEMO00000742")])
  assert.equal(d[0].label, "Laptop")
  assert.equal(d[0].shortLabel, "Laptop")
  assert.equal(d[0].tag, "laptop")
})

test("labelsFor: a laptop never takes part in duplicate detection", () => {
  const out = Model.labelsFor([
    { isLaptop: true, name: "eDP-1", make: "LG Display", model: "0x07C8", physicalWidth: 300, physicalHeight: 190 },
    { isLaptop: false, name: "DP-1", make: "LG Display", model: "0x07C8", physicalWidth: 300, physicalHeight: 190, serial: "" }
  ])
  assert.deepEqual(out.map((o) => o.label), ["Laptop", "LG Display 14.0" + IN])
})

test("removesOutput: only mirror and laptop-off take an output away", () => {
  assert.equal(Model.removesOutput("mirror"), true)
  assert.equal(Model.removesOutput("laptop-off"), true)
  assert.equal(Model.removesOutput("normal"), false)
  assert.equal(Model.removesOutput(""), false)
})
