// Display arranger model: catalog of arrangements, position maths, current
// arrangement detection, the configured-scale reader, and the Lua text for the
// live eval and the persisted file. Plain JS so Node tests can load it
// (module.exports at the bottom) and QML can import it ("Model.js" as Model).
// No QML or Node APIs in here.
//
// What a tile rectangle shows is picked from the display's caption forms
// (captionForms: label, compact label "Northwind 15″", brand; for a
// duplicate, the forms with the serial tail, then "Northwind 0742", then
// "0742") by fitCaption(), which TileGrid.qml and the tests share. The
// three-character tag is never a caption: a unique display never shows its
// serial.
//
// Display labels are brand plus diagonal inches ("Northwind 15.3″"), with the
// serial tail only when two connected displays would read the same; see
// labelsFor().
//
// The persisted file (format 2) stores no scale, transform or mode for any
// display. Its loader reads them from ~/.config/hypr/monitors.lua
// at config load and computes the positions from the logical sizes they give,
// so a scale set with Omarchy's Display panel takes effect after a tile click,
// and a click made while Omarchy's mirror or laptop-off toggle is on cannot
// freeze the toggle's temporary scale into the file. The same reader runs here
// (configuredDisplays) for the tile pictures and the live eval.

var LAPTOP_NAME = /^(eDP|LVDS|DSI)-/
// Hyprland stands in FALLBACK when nothing is enabled; a headless output is a
// virtual screen. Neither is a display to arrange.
var SKIP_NAME = /^(FALLBACK|HEADLESS-)/i

var FORMAT_VERSION = 2
var TOLERANCE = 2

// ---------- numbers ----------

// Canonical text of a scale: two decimals, trailing zeros dropped ("1", "1.25",
// "1.6").
function scaleKey(scale) {
  var n = Number(scale)
  if (!isFinite(n) || n <= 0) return "1"
  return n.toFixed(2).replace(/\.?0+$/, "")
}

function isIntegral(x) {
  return x === Math.round(x)
}

// The scale Hyprland 0.56 ends up with for a requested scale: when the mode
// does not divide into whole logical pixels it searches, in 1/120 steps, up
// then down, for the nearest scale that does (Monitor.cpp, applyMonitorRule).
// Omarchy's Display panel only offers clean scales, so this changes nothing
// for them; it keeps the maths right for a hand-written scale like 1.3.
function validScale(scale, width, height) {
  var s = Number(scale), w = Number(width), h = Number(height)
  if (!isFinite(s) || s <= 0 || !(w > 0 && h > 0)) return s
  if (isIntegral(w / s) && isIntegral(h / s)) return s
  var search = Math.round(s * 120)
  var zero = search / 120
  if (isIntegral(w / zero) && isIntegral(h / zero)) return zero
  for (var i = 1; i < 90; i++) {
    var up = (search + i) / 120, down = (search - i) / 120
    if (isIntegral(w / up) && isIntegral(h / up)) return up
    if (down > 0 && isIntegral(w / down) && isIntegral(h / down)) return down
  }
  return s
}

// ---------- parsing hyprctl monitors all -j ----------

function parseModeText(text) {
  var m = /^(\d+)x(\d+)(?:@([\d.]+))?/.exec(String(text || ""))
  if (!m) return null
  return { width: Number(m[1]), height: Number(m[2]), refresh: m[3] ? Number(m[3]) : 0 }
}

function tagFor(display, index) {
  var serial = String(display.serial || "")
  if (serial.length >= 3) return serial.slice(-3)
  return String.fromCharCode(65 + index)
}

// ---------- labels for displays ----------

// Company suffixes that add nothing to a brand on a tile: "Northwind
// Corporation" reads as "Northwind". Matched as whole trailing words, in any
// order, case-insensitively, with or without a dot or a trailing comma.
var BRAND_SUFFIX = /^(corporation|corp|inc|incorporated|co|company|ltd|limited|gmbh|ag|llc|plc|sa|srl|bv|nv|kg|pty|technologies|technology|electronics|electric|international)\.?,?$/i

// The brand as shown on a tile: the make with its company suffixes removed.
// A make that is only suffixes keeps its first word.
function shortBrand(make) {
  var words = String(make || "").replace(/,/g, ", ").trim().split(/\s+/).filter(function(w) { return w !== "" })
  if (words.length === 0) return ""
  while (words.length > 1 && BRAND_SUFFIX.test(words[words.length - 1])) words.pop()
  return words.join(" ").replace(/,$/, "")
}

// Diagonal in inches, one decimal, from the physical size in millimetres
// (hyprctl's physicalWidth and physicalHeight); null when either is missing.
function diagonalInches(widthMm, heightMm) {
  var w = Number(widthMm), h = Number(heightMm)
  if (!(w > 0 && h > 0)) return null
  return Math.round(Math.sqrt(w * w + h * h) / 25.4 * 10) / 10
}

function inchesText(inches) {
  return inches.toFixed(1) + "\u2033"
}

// Brand plus size ("Northwind 15.3″"); brand plus model when the size is
// unknown ("Northwind NW-1560"); the make or model alone when that is all
// there is; the connector name as the last resort.
function baseLabel(display) {
  var brand = shortBrand(display.make)
  var inches = diagonalInches(display.physicalWidth, display.physicalHeight)
  var model = String(display.model || "").trim()
  if (brand && inches !== null) return brand + " " + inchesText(inches)
  if (brand && model) return brand + " " + model
  if (brand) return brand
  if (inches !== null && model) return model + " " + inchesText(inches)
  if (model) return model
  return String(display.name || "")
}

// ---------- rectangle captions ----------

// The smallest font pixel size a tile rectangle's caption shrinks to before
// it is elided, and the same for the mirror tile's corner overlay
// (TileGrid.qml).
var CAPTION_MIN_PX = 7
var OVERLAY_MIN_PX = 6

// Whole inches for the compact form: "15″" for 15.3.
function compactInchesText(inches) {
  return String(Math.round(inches)) + "\u2033"
}

// What a tile rectangle may show for a display, longest first: its label,
// the compact label (brand plus whole inches), the brand. For a duplicate,
// `suffix` is what the label ends with ("(0742)" or "A") and `tail` the bare
// tail ("0742" or "A"): the label, the compact label with the suffix, the
// brand plus the tail, the tail. The brand's place is taken by the model, or
// the connector name, when the display has none. fitCaption() picks from
// this list only, so the three-character tag never shows.
function captionForms(display, label, suffix, tail) {
  var brand = shortBrand(display.make)
  var inches = diagonalInches(display.physicalWidth, display.physicalHeight)
  var model = String(display.model || "").trim()
  var head = brand || model || String(display.name || "")
  var compact = inches !== null ? head + " " + compactInchesText(inches) : ""
  var forms = [label]
  if (tail) {
    if (compact) forms.push(compact + " " + suffix)
    forms.push(head + " " + tail, tail)
  } else {
    if (compact) forms.push(compact)
    forms.push(head)
  }
  return forms.filter(function(f, i) { return f !== "" && f !== forms[i - 1] })
}

// The caption for a rectangle `room` pixels across at `pixelSize`: the first
// form that fits at that size; else the last form, at the largest size down
// to `minPixelSize` at which it fits; else the last form at the minimum,
// marked `elided` for the Text to elide ("View…"). measure(text, pixelSize)
// returns the advance width in the caption font. Pure, so TileGrid.qml and
// the tests share it.
function fitCaption(forms, room, pixelSize, minPixelSize, measure) {
  var list = (forms || []).map(function(f) { return String(f || "") }).filter(function(f) { return f !== "" })
  if (list.length === 0) return { text: "", pixelSize: pixelSize, elided: false }
  for (var i = 0; i < list.length; i++)
    if (measure(list[i], pixelSize) <= room) return { text: list[i], pixelSize: pixelSize, elided: false }
  var last = list[list.length - 1]
  for (var size = pixelSize - 1; size >= minPixelSize; size--)
    if (measure(last, size) <= room) return { text: last, pixelSize: size, elided: false }
  return { text: last, pixelSize: Math.min(pixelSize, minPixelSize), elided: true }
}

// Labels for the connected displays: the laptop is "Laptop"; an external is
// its base label, plus the last four serial characters in parentheses only
// when another connected display gets the same base label ("Northwind 15.3″
// (0742)"), or A, B, ... in connection order when a duplicate has no serial.
// Returns { label, shortLabel, captions } per display, in the order given;
// captions is the list captionForms() gives for the rectangles.
function labelsFor(displays) {
  var bases = displays.map(function(d) { return d.isLaptop ? null : baseLabel(d) })
  var count = {}
  bases.forEach(function(b) { if (b !== null) count[b] = (count[b] || 0) + 1 })
  var letterIndex = 0
  return displays.map(function(d, i) {
    if (d.isLaptop) return { label: "Laptop", shortLabel: "Laptop", captions: ["Laptop"] }
    var base = bases[i]
    var brand = shortBrand(d.make)
    if (count[base] < 2) return { label: base, shortLabel: brand || base, captions: captionForms(d, base, "", "") }
    var serial = String(d.serial || "").trim()
    if (serial.length >= 4) {
      var tail = serial.slice(-4)
      var label = base + " (" + tail + ")"
      return { label: label, shortLabel: tail, captions: captionForms(d, label, "(" + tail + ")", tail) }
    }
    var letter = String.fromCharCode(65 + letterIndex++)
    return { label: base + " " + letter, shortLabel: letter, captions: captionForms(d, base + " " + letter, letter, letter) }
  })
}

// Normalized displays, laptop first, externals in a stable order (by output
// key) so tile order does not follow DP-n plug order. Scales and transforms
// here are the live ones; configuredDisplays() replaces them with what
// monitors.lua says.
function parseMonitors(raw) {
  var list = []
  try {
    list = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw || [])
  } catch (e) {
    list = []
  }
  if (!Array.isArray(list)) list = []

  var displays = []
  for (var i = 0; i < list.length; i++) {
    var m = list[i]
    if (!m || typeof m !== "object") continue
    var name = String(m.name || "")
    if (!name || SKIP_NAME.test(name)) continue

    var preferred = parseModeText(Array.isArray(m.availableModes) ? m.availableModes[0] : "")
    var width = Number(m.width), height = Number(m.height), refresh = Number(m.refreshRate)
    if (!(width > 0 && height > 0)) {
      // A disabled display reports no size: take its first listed mode.
      if (!preferred) continue
      width = preferred.width
      height = preferred.height
      refresh = preferred.refresh
    }

    var transform = Number(m.transform)
    transform = transform >= 0 && transform <= 7 ? Math.floor(transform) : 0
    var scale = Number(m.scale)
    if (!(scale > 0)) scale = 1
    var mirrorOf = String(m.mirrorOf || "none")

    displays.push({
      name: name,
      description: String(m.description || ""),
      serial: String(m.serial || ""),
      make: String(m.make || ""),
      model: String(m.model || ""),
      physicalWidth: Number(m.physicalWidth) > 0 ? Number(m.physicalWidth) : 0,
      physicalHeight: Number(m.physicalHeight) > 0 ? Number(m.physicalHeight) : 0,
      isLaptop: LAPTOP_NAME.test(name),
      width: width,
      height: height,
      refresh: isFinite(refresh) ? refresh : 0,
      transform: transform,
      scale: scale,
      liveScale: scale,
      x: Number(m.x) || 0,
      y: Number(m.y) || 0,
      disabled: m.disabled === true,
      mirrorOf: mirrorOf === "" ? "none" : mirrorOf,
      modeText: "",
      scaleKnown: false
    })
  }

  var laptops = displays.filter(function(d) { return d.isLaptop })
  // Only the first internal panel is "the laptop"; a second one is arranged
  // like any external.
  for (var j = 1; j < laptops.length; j++) laptops[j].isLaptop = false

  var descCount = {}
  displays.forEach(function(d) {
    if (!d.isLaptop && d.description) descCount[d.description] = (descCount[d.description] || 0) + 1
  })
  displays.forEach(function(d) {
    // Externals by description (it carries the serial), so a layout follows the
    // monitor, not the port. Two identical monitors without serials cannot be
    // told apart that way; they fall back to the connector name.
    if (d.isLaptop) d.key = d.name
    else if (d.description && descCount[d.description] === 1) d.key = "desc:" + d.description
    else d.key = d.name
  })

  var laptop = displays.filter(function(d) { return d.isLaptop })
  var externals = displays.filter(function(d) { return !d.isLaptop })
  externals.sort(function(a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0) })
  externals.forEach(function(d, idx) { d.tag = tagFor(d, idx) })
  laptop.forEach(function(d) { d.tag = "laptop" })
  // Labels in connection order, so duplicate letters follow the plug order.
  var labels = labelsFor(displays)
  displays.forEach(function(d, idx) {
    d.label = labels[idx].label
    d.shortLabel = labels[idx].shortLabel
    d.captions = labels[idx].captions
  })
  return laptop.concat(externals)
}

// What the tiles depend on in a `hyprctl monitors all -j` snapshot: the
// parsed displays, without the volatile fields (focus, workspaces, dpms) that
// change between polls while nothing about the layout does.
function liveSignature(raw) {
  return JSON.stringify(parseMonitors(raw))
}

function laptopOf(displays) {
  for (var i = 0; i < displays.length; i++) if (displays[i].isLaptop) return displays[i]
  return null
}

function externalsOf(displays) {
  return displays.filter(function(d) { return !d.isLaptop })
}

// ---------- monitors.lua: the configured scale, transform and mode ----------
//
// This mirrors the Lua loader in the persisted file (LOADER below) and
// Hyprland 0.56's own rules, verified in its source (MonitorRuleManager.cpp,
// Monitor.cpp, lua/bindings/LuaBindingsConfigRules.cpp) and in a nested
// instance:
// - hl.monitor for an output string that already has a rule updates that rule
//   (fields it does not name are kept) and moves it to the end of the list.
// - The rule applied to a monitor is the last one in that list whose output
//   is the monitor's connector name, or "desc:<prefix>" of its description.
//   The catch-all rule (output = "") is used only when no rule matches, whatever
//   its place in the file.
// - A rule that names no scale means "auto": Hyprland picks a scale from the
//   panel's size. That cannot be read from the file, so it counts as unknown.
// Only one-line rules are read. A value in double or single quotes stands for
// itself, a bare word may name a `local`, a number is a number; anything else
// (an expression) is unknown.

function stripComments(line) {
  return String(line).replace(/--\[\[.*?\]\]/g, "").replace(/--.*$/, "")
}

// First `local <name> = <value>` per name. Expressions do not count.
function parseLocals(lines) {
  var locals = {}
  lines.forEach(function(line) {
    var m = /^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(stripComments(line))
    if (!m || m[2] === "" || Object.prototype.hasOwnProperty.call(locals, m[1])) return
    var quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(m[2])
    if (quoted) locals[m[1]] = quoted[1] !== undefined ? quoted[1] : quoted[2]
    else if (!/\s/.test(m[2])) locals[m[1]] = m[2]
  })
  return locals
}

// The text a field value stands for, or null when it cannot be known here.
function scalarText(value, locals) {
  if (value === undefined || value === null) return null
  var v = String(value).trim()
  if (v === "") return null
  var quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(v)
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2]
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return Object.prototype.hasOwnProperty.call(locals, v) ? locals[v] : null
  if (/^[0-9.]+$/.test(v)) return v
  return null
}

function lastField(fields, name) {
  var re = new RegExp(",\\s*" + name + "\\s*=\\s*([^,]*)", "g")
  var m, last
  while ((m = re.exec(fields)) !== null) last = m[1]
  return last === undefined ? undefined : last.trim()
}

// One-line hl.monitor rules, merged by output string like Hyprland does. Each
// entry: { output, rank, scale, transform, mode } where scale is a number,
// null (auto, or not readable) or undefined (never named); transform an
// integer or undefined; mode a string or undefined.
function parseRules(lines, locals) {
  var rules = {}
  var rank = 0
  lines.forEach(function(line) {
    var code = stripComments(line)
    var m = /^\s*hl\.monitor\s*\(\s*\{(.*)\}\s*\)\s*$/.exec(code)
    if (!m) return
    var fields = "," + m[1].replace(/;/g, ",")
    var out = /,\s*output\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(fields)
    if (!out) return
    var output = out[1] !== undefined ? out[1] : out[2]
    var rule = rules[output]
    if (!rule) rule = rules[output] = { output: output }
    rank++
    rule.rank = rank

    var scale = lastField(fields, "scale")
    if (scale !== undefined) {
      var text = scalarText(scale, locals)
      var n = text !== null && /^[0-9.]+$/.test(text) ? Number(text) : NaN
      rule.scale = isFinite(n) && n > 0 ? n : null
    }
    var transform = lastField(fields, "transform")
    if (transform !== undefined) {
      var t = scalarText(transform, locals)
      rule.transform = t !== null && /^[0-7]$/.test(t) ? Number(t) : 0
    }
    var mode = lastField(fields, "mode")
    if (mode !== undefined) {
      var mt = scalarText(mode, locals)
      if (mt !== null && mt !== "") rule.mode = mt
    }
  })
  return rules
}

function parseConfig(text) {
  var lines = String(text || "").split("\n")
  var locals = parseLocals(lines)
  return { locals: locals, rules: parseRules(lines, locals) }
}

// Hyprland's CMonitor::matchesStaticSelector.
function matchesSelector(output, display) {
  if (output.slice(0, 5) === "desc:") {
    var sel = output.slice(5).trim()
    return sel !== "" && String(display.description || "").slice(0, sel.length) === sel
  }
  return output === display.name
}

// What monitors.lua gives one display: { scale, transform, mode, rule }.
// scale is a number or null (unknown); mode defaults to "preferred", the
// value of a rule that names none and of Omarchy's catch-all.
function resolveDisplay(display, config) {
  var best = null
  Object.keys(config.rules).forEach(function(output) {
    var rule = config.rules[output]
    if (output === "" || !matchesSelector(output, display)) return
    if (!best || rule.rank > best.rank) best = rule
  })
  var base = best || config.rules[""] || null
  var scale = base && typeof base.scale === "number" ? base.scale : null
  var transform = base && typeof base.transform === "number" ? base.transform : 0
  var mode = base && base.mode ? base.mode : "preferred"
  return { scale: scale, transform: transform, mode: mode, rule: base ? base.output : null }
}

// Displays with the configured scale, transform and mode in place of the live
// ones. With no readable scale, the live scale stands in for the tile
// pictures and the eval when it is trustworthy (the display is on and not
// mirroring), else 1; the file records it as that display's fallback_scale,
// so the loader lands on the same positions (see fileText).
function configuredDisplays(displays, monitorsLua) {
  var config = parseConfig(monitorsLua)
  return displays.map(function(d) {
    var r = resolveDisplay(d, config)
    var out = {}
    Object.keys(d).forEach(function(k) { out[k] = d[k] })
    out.scaleKnown = r.scale !== null
    out.scale = r.scale !== null ? r.scale : (!d.disabled && d.mirrorOf === "none" ? d.liveScale : 1)
    out.transform = r.transform
    out.modeText = r.mode
    out.rule = r.rule
    return out
  })
}

// Pixel size of the mode the display will run: a literal mode in
// monitors.lua, else the size hyprctl reported (its preferred mode).
function modePixels(display) {
  var m = parseModeText(display.modeText)
  if (m) return { w: m.width, h: m.height }
  return { w: display.width, h: display.height }
}

// Logical size: the mode turned by the transform, divided by the scale
// Hyprland will accept, rounded like Hyprland (Monitor.cpp: (size / scale).round()).
function logicalSize(display, scale) {
  var px = modePixels(display)
  var s = Number(scale === undefined ? display.scale : scale)
  if (!(s > 0)) s = 1
  s = validScale(s, px.w, px.h)
  var turned = display.transform % 2 === 1
  var w = turned ? px.h : px.w
  var h = turned ? px.w : px.h
  return { w: Math.round(w / s), h: Math.round(h / s) }
}

// ---------- catalog ----------

// A tile spec names a kind and the output keys it orders. place() turns a
// spec plus logical sizes into positions; the catalog, the eval, the tests and
// the Lua loader in the persisted file (its own copy of place) all agree.
//
// Convention: the laptop sits at 0x0 whenever it is on, so it never jumps when
// an external is unplugged; externals above or left get negative coordinates.
// With the laptop off, the arrangement starts at 0x0.

function half(n) {
  return Math.floor(n / 2)
}

function place(spec, sizes) {
  var L = spec.laptop
  var p = {}
  var a, b, i, x, keys
  switch (spec.kind) {
  case "above":
    a = spec.order[0]
    p[L] = { x: 0, y: 0 }
    p[a] = { x: half(sizes[L].w - sizes[a].w), y: -sizes[a].h }
    break
  case "below":
    a = spec.order[0]
    p[L] = { x: 0, y: 0 }
    p[a] = { x: half(sizes[L].w - sizes[a].w), y: sizes[L].h }
    break
  case "left":
    a = spec.order[0]
    p[L] = { x: 0, y: 0 }
    p[a] = { x: -sizes[a].w, y: half(sizes[L].h - sizes[a].h) }
    break
  case "right":
    a = spec.order[0]
    p[L] = { x: 0, y: 0 }
    p[a] = { x: sizes[L].w, y: half(sizes[L].h - sizes[a].h) }
    break
  case "mirror":
    // The file keeps "above" as the extended layout behind Omarchy's mirror
    // toggle, used when mirroring is turned off elsewhere.
    return place({ kind: "above", laptop: L, order: spec.order }, sizes)
  case "row":
    // Left to right, every display centered on the laptop's horizontal
    // center line, then shifted so the laptop sits at 0x0.
    keys = spec.order
    x = 0
    for (i = 0; i < keys.length; i++) {
      p[keys[i]] = { x: x, y: half(sizes[L].h - sizes[keys[i]].h) }
      x += sizes[keys[i]].w
    }
    var shift = p[L].x
    for (i = 0; i < keys.length; i++) p[keys[i]].x -= shift
    break
  case "pair-above":
    // Both externals side by side above the laptop, bottoms on its top edge,
    // the pair centered on it.
    a = spec.order[0]
    b = spec.order[1]
    x = half(sizes[L].w - (sizes[a].w + sizes[b].w))
    p[L] = { x: 0, y: 0 }
    p[a] = { x: x, y: -sizes[a].h }
    p[b] = { x: x + sizes[a].w, y: -sizes[b].h }
    break
  case "above-left":
  case "above-right":
    // One external above (centered), the other beside the laptop with top
    // edges aligned. Centering the side one vertically would push it into the
    // one above whenever it is taller than the laptop.
    a = spec.order[0]
    b = spec.order[1]
    p[L] = { x: 0, y: 0 }
    p[a] = { x: half(sizes[L].w - sizes[a].w), y: -sizes[a].h }
    p[b] = { x: spec.kind === "above-left" ? -sizes[b].w : sizes[L].w, y: 0 }
    break
  case "off":
  case "off-row":
  case "ext-row":
    // Externals left to right from 0x0, centered on the first one. With a
    // laptop present (laptop off) its rule is kept below the row, centered,
    // for when Omarchy's laptop-off toggle is lifted.
    keys = spec.order
    x = 0
    var first = sizes[keys[0]]
    var bottom = 0
    for (i = 0; i < keys.length; i++) {
      var y = half(first.h - sizes[keys[i]].h)
      p[keys[i]] = { x: x, y: y }
      x += sizes[keys[i]].w
      bottom = Math.max(bottom, y + sizes[keys[i]].h)
    }
    if (L) p[L] = { x: half(x - sizes[L].w), y: bottom }
    break
  case "ext-stack":
    a = spec.order[0]
    b = spec.order[1]
    p[a] = { x: 0, y: 0 }
    p[b] = { x: half(sizes[a].w - sizes[b].w), y: sizes[a].h }
    break
  default:
    throw new Error("unknown arrangement kind: " + spec.kind)
  }
  return p
}

// Whether applying a tile of this mode takes an output away (Omarchy's
// laptop-off disables the laptop panel; mirror turns the external into a
// mirror, and Hyprland removes a mirror's wl_output too). The popup must be
// closed before such a change: see Panel.qml and the README.
function removesOutput(mode) {
  return mode === "mirror" || mode === "laptop-off"
}

function modeOf(kind) {
  if (kind === "off" || kind === "off-row") return "laptop-off"
  if (kind === "mirror") return "mirror"
  return "normal"
}

function tileId(spec) {
  return spec.kind + ":" + spec.order.join("|")
}

function specs(displays) {
  var laptop = laptopOf(displays)
  var ext = externalsOf(displays).map(function(d) { return d.key })
  var L = laptop ? laptop.key : null
  var list = []

  if (laptop && ext.length === 1) {
    var e = ext[0]
    ;["above", "left", "right", "below", "off", "mirror"].forEach(function(kind) {
      list.push({ kind: kind, laptop: L, order: [e] })
    })
  } else if (laptop && ext.length === 2) {
    var A = ext[0], B = ext[1]
    var orders = [[A, L, B], [B, L, A], [L, A, B], [L, B, A], [A, B, L], [B, A, L]]
    orders.forEach(function(o) { list.push({ kind: "row", laptop: L, order: o }) })
    list.push({ kind: "pair-above", laptop: L, order: [A, B] })
    list.push({ kind: "pair-above", laptop: L, order: [B, A] })
    list.push({ kind: "above-right", laptop: L, order: [A, B] })
    list.push({ kind: "above-left", laptop: L, order: [A, B] })
    list.push({ kind: "above-right", laptop: L, order: [B, A] })
    list.push({ kind: "above-left", laptop: L, order: [B, A] })
    list.push({ kind: "off-row", laptop: L, order: [A, B] })
    list.push({ kind: "off-row", laptop: L, order: [B, A] })
  } else if (!laptop && ext.length === 2) {
    list.push({ kind: "ext-row", laptop: null, order: [ext[0], ext[1]] })
    list.push({ kind: "ext-row", laptop: null, order: [ext[1], ext[0]] })
    list.push({ kind: "ext-stack", laptop: null, order: [ext[0], ext[1]] })
    list.push({ kind: "ext-stack", laptop: null, order: [ext[1], ext[0]] })
  }
  return list
}

function sizesFor(displays) {
  var sizes = {}
  displays.forEach(function(d) { sizes[d.key] = logicalSize(d) })
  return sizes
}

function geometrySignature(spec, positions) {
  var keys = Object.keys(positions).sort()
  return modeOf(spec.kind) + ";" + keys.map(function(k) {
    return k + "=" + positions[k].x + "," + positions[k].y
  }).join(";")
}

// Why the catalog is empty, for the note in the popup.
function emptyReason(displays) {
  var laptop = laptopOf(displays)
  var ext = externalsOf(displays).length
  if (displays.length === 0) return "none"
  if (displays.length === 1) return laptop ? "laptop-only" : "single"
  if (ext > 2) return "too-many"
  return ""
}

// Tiles for the displays connected now, at their configured scales.
function catalog(displays, tr) {
  var sizes = sizesFor(displays)
  var seen = {}
  var tiles = []
  specs(displays).forEach(function(spec) {
    var positions = place(spec, sizes)
    var sig = geometrySignature(spec, positions)
    if (seen[sig]) return
    seen[sig] = true
    tiles.push({
      id: tileId(spec),
      kind: spec.kind,
      mode: modeOf(spec.kind),
      spec: spec,
      positions: positions,
      label: tileLabel(spec, displays, tr),
      drawing: drawing(spec, positions, sizes, displays)
    })
  })
  return tiles
}

// Rectangles for the tile picture, in logical pixels, plus their bounds.
function drawing(spec, positions, sizes, displays) {
  var mode = modeOf(spec.kind)
  var rects = []
  displays.forEach(function(d) {
    var pos = positions[d.key]
    var size = sizes[d.key]
    rects.push({
      key: d.key,
      tag: d.tag,
      label: d.label,
      shortLabel: d.shortLabel,
      captions: d.captions,
      laptop: d.isLaptop,
      off: mode === "laptop-off" && d.isLaptop,
      mirror: mode === "mirror" && !d.isLaptop,
      x: pos.x, y: pos.y, w: size.w, h: size.h
    })
  })
  if (mode === "mirror") {
    // Picture the external stacked behind the laptop, a little offset.
    var lap = rects.filter(function(r) { return r.laptop })[0]
    rects.forEach(function(r) {
      if (!r.mirror) return
      r.w = lap.w
      r.h = lap.h
      r.x = lap.x + Math.round(lap.w * 0.14)
      r.y = lap.y - Math.round(lap.h * 0.18)
    })
    // External first so the laptop draws on top.
    rects.sort(function(a, b) { return (a.laptop ? 1 : 0) - (b.laptop ? 1 : 0) })
  }
  if (mode === "laptop-off") {
    // The laptop picture shrinks to a small marker under the externals.
    rects.forEach(function(r) {
      if (!r.off) return
      var w = Math.round(r.w * 0.5), h = Math.round(r.h * 0.5)
      r.x = r.x + Math.round((r.w - w) / 2)
      r.w = w
      r.h = h
    })
  }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  rects.forEach(function(r) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  })
  return { rects: rects, x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ---------- labels ----------

function englishTr(key, english) {
  return english
}

function nameOf(key, displays, t) {
  for (var i = 0; i < displays.length; i++) {
    if (displays[i].key !== key) continue
    if (displays[i].isLaptop) return t("display.laptop", "laptop")
    return t("display.external", "%1").replace("%1", displays[i].label)
  }
  return key
}

function capitalize(text) {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function tileLabel(spec, displays, tr) {
  return capitalize(tileSentence(spec, displays, tr))
}

function tileSentence(spec, displays, tr) {
  var t = typeof tr === "function" ? tr : englishTr
  var n = function(k) { return nameOf(k, displays, t) }
  var o = spec.order
  var fill = function(text, args) {
    return text.replace(/%(\d)/g, function(all, idx) { return args[Number(idx) - 1] })
  }
  switch (spec.kind) {
  case "above": return fill(t("tile.above", "%1 above the laptop"), [n(o[0])])
  case "below": return fill(t("tile.below", "%1 below the laptop"), [n(o[0])])
  case "left": return fill(t("tile.left", "%1 left of the laptop"), [n(o[0])])
  case "right": return fill(t("tile.right", "%1 right of the laptop"), [n(o[0])])
  case "off": return fill(t("tile.off", "%1 only, laptop off"), [n(o[0])])
  case "mirror": return fill(t("tile.mirror", "Laptop mirrored on %1"), [n(o[0])])
  case "row": return fill(t("tile.row", "Left to right: %1, %2, %3"), o.map(n))
  case "pair-above": return fill(t("tile.pairAbove", "%1 and %2 above the laptop"), o.map(n))
  case "above-left": return fill(t("tile.aboveLeft", "%1 above, %2 left of the laptop"), o.map(n))
  case "above-right": return fill(t("tile.aboveRight", "%1 above, %2 right of the laptop"), o.map(n))
  case "off-row": return fill(t("tile.offRow", "%1 and %2 side by side, laptop off"), o.map(n))
  case "ext-row": return fill(t("tile.extRow", "Left to right: %1, %2"), o.map(n))
  case "ext-stack": return fill(t("tile.extStack", "%1 above %2"), o.map(n))
  }
  return spec.kind
}

// ---------- current arrangement ----------

function liveState(displays) {
  var mirror = displays.some(function(d) { return d.mirrorOf !== "none" && !d.disabled })
  var laptop = laptopOf(displays)
  return {
    mirror: mirror,
    laptopOff: !!(laptop && laptop.disabled),
    enabled: displays.filter(function(d) { return !d.disabled })
  }
}

// The tile matching what Hyprland shows now, or "" when none does.
// Positions compare after a shift (relative to the laptop, or to the first
// display when the laptop is off), with a 2 px tolerance for rounding.
function currentTileId(tiles, displays) {
  var live = liveState(displays)
  var byKey = {}
  displays.forEach(function(d) { byKey[d.key] = d })

  for (var i = 0; i < tiles.length; i++) {
    var tile = tiles[i]
    if (tile.mode === "mirror") {
      if (live.mirror) return tile.id
      continue
    }
    if (live.mirror) continue
    if ((tile.mode === "laptop-off") !== live.laptopOff) continue

    var keys = tile.spec.order.slice()
    if (tile.spec.laptop && tile.mode !== "laptop-off") keys.unshift(tile.spec.laptop)
    var allOn = keys.every(function(k) { return byKey[k] && !byKey[k].disabled })
    if (!allOn) continue

    var ref = keys[0]
    var ok = keys.every(function(k) {
      var dx = (byKey[k].x - byKey[ref].x) - (tile.positions[k].x - tile.positions[ref].x)
      var dy = (byKey[k].y - byKey[ref].y) - (tile.positions[k].y - tile.positions[ref].y)
      return Math.abs(dx) <= TOLERANCE && Math.abs(dy) <= TOLERANCE
    })
    if (ok) return tile.id
  }
  return ""
}

// ---------- Lua ----------

function utf8Bytes(s) {
  var bytes = []
  for (var i = 0; i < s.length; i++) {
    var c = s.codePointAt(i)
    if (c > 0xffff) i++
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return bytes
}

// A Lua string literal for any text: printable ASCII stays, quote and
// backslash are escaped, everything else becomes \ddd. Monitor descriptions
// come from EDID, so nothing in them may close the string.
function luaString(s) {
  var out = '"'
  utf8Bytes(String(s)).forEach(function(b) {
    if (b === 34) out += '\\"'
    else if (b === 92) out += "\\\\"
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b)
    else out += "\\" + ("00" + b).slice(-3)
  })
  return out + '"'
}

function positionText(pos) {
  return pos.x + "x" + pos.y
}

function ruleText(fields) {
  return "hl.monitor({ " + fields.join(", ") + " })"
}

// The rule fields the loader and the eval share for one display: the mode
// monitors.lua names (else "preferred"), the position, the configured scale
// when it is known (an unknown scale is left to Hyprland: an earlier rule for
// the same output keeps its own, a new rule gets "auto"), the transform when
// it is not 0.
function ruleFields(display, pos) {
  var fields = [
    "output = " + luaString(display.key),
    "mode = " + luaString(display.modeText || "preferred"),
    "position = " + luaString(positionText(pos))
  ]
  if (display.scaleKnown) fields.push("scale = " + scaleKey(display.scale))
  if (display.transform) fields.push("transform = " + display.transform)
  return fields
}

// One hyprctl eval with an hl.monitor call for every connected display, at
// the configured scales. Only used for "normal" tiles; laptop-off and mirror
// go through Omarchy's own toggles (see apply.sh). With opts.keepLaptopState
// the laptop rule leaves out `disabled = false`, so a laptop that Omarchy's
// clamshell toggle turned off (lid shut while docked) stays off: hl.monitor
// updates the existing rule and keeps what it does not name.
function evalExpression(tile, displays, opts) {
  opts = opts || {}
  var rules = []
  displays.forEach(function(d) {
    if (opts.externalsOnly && d.isLaptop) return
    var fields = ruleFields(d, tile.positions[d.key])
    if (!(d.isLaptop && opts.keepLaptopState)) fields.push("disabled = false")
    rules.push(ruleText(fields))
  })
  return rules.join(" ")
}

function setKey(displays) {
  return displays.map(function(d) { return d.key }).sort().join(" + ")
}

// The loader below is fixed text, the same in every generated file. It is
// the Lua twin of parseConfig/resolveDisplay/logicalSize/place above;
// test/lua.test.js checks the two agree. It reads the laptop scale the way
// Omarchy's omarchy-hyprland-monitor-clamshell does (the laptop's own rule in
// monitors.lua, then the catch-all, then local omarchy_monitor_scale), so
// both agree and the clamshell poll finds nothing to correct.
var LOADER = [
  "-- Loader: fixed text, the same in every generated file. It reads each display's",
  "-- scale, transform and mode from monitors.lua (last matching rule wins, as in",
  "-- Hyprland) and places the displays at the logical sizes those give.",
  "local function read_lines(path)",
  "  local file = io.open(path, \"r\")",
  "  if not file then return nil end",
  "  local lines = {}",
  "  for line in file:lines() do lines[#lines + 1] = line end",
  "  file:close()",
  "  return lines",
  "end",
  "",
  "local function strip_comments(line)",
  "  return (line:gsub(\"%-%-%[%[.-%]%]\", \"\"):gsub(\"%-%-.*$\", \"\"))",
  "end",
  "",
  "local function trim(text)",
  "  return (text:match(\"^%s*(.-)%s*$\"))",
  "end",
  "",
  "-- First `local <name> = <value>` per name; an expression does not count.",
  "local function parse_locals(lines)",
  "  local locals = {}",
  "  for _, line in ipairs(lines) do",
  "    local name, value = strip_comments(line):match(\"^%s*local%s+([%a_][%w_]*)%s*=%s*(.-)%s*$\")",
  "    if name and value ~= \"\" and locals[name] == nil then",
  "      local quoted = value:match('^\"([^\"]*)\"$') or value:match(\"^'([^']*)'$\")",
  "      if quoted then locals[name] = quoted",
  "      elseif not value:find(\"%s\") then locals[name] = value end",
  "    end",
  "  end",
  "  return locals",
  "end",
  "",
  "-- The text a field value stands for, or nil when it cannot be known here.",
  "local function scalar_text(value, locals)",
  "  if value == nil then return nil end",
  "  value = trim(value)",
  "  if value == \"\" then return nil end",
  "  local quoted = value:match('^\"([^\"]*)\"$') or value:match(\"^'([^']*)'$\")",
  "  if quoted then return quoted end",
  "  if value:match(\"^[%a_][%w_]*$\") then return locals[value] end",
  "  if value:match(\"^[%d%.]+$\") then return value end",
  "  return nil",
  "end",
  "",
  "local function last_field(fields, name)",
  "  local last = nil",
  "  for v in fields:gmatch(\",%s*\" .. name .. \"%s*=%s*([^,]*)\") do last = v end",
  "  return last",
  "end",
  "",
  "-- One-line hl.monitor rules, merged by output string like Hyprland does.",
  "local function parse_rules(lines, locals)",
  "  local rules, rank = {}, 0",
  "  for _, line in ipairs(lines) do",
  "    local body = strip_comments(line):match(\"^%s*hl%.monitor%s*%(%s*%{(.*)%}%s*%)%s*$\")",
  "    if body then",
  "      local fields = \",\" .. body:gsub(\";\", \",\")",
  "      local output = fields:match(',%s*output%s*=%s*\"([^\"]*)\"') or fields:match(\",%s*output%s*=%s*'([^']*)'\")",
  "      if output then",
  "        local rule = rules[output]",
  "        if not rule then rule = { output = output }; rules[output] = rule end",
  "        rank = rank + 1",
  "        rule.rank = rank",
  "        local scale = last_field(fields, \"scale\")",
  "        if scale then",
  "          local text = scalar_text(scale, locals)",
  "          local n = text and text:match(\"^[%d%.]+$\") and tonumber(text) or nil",
  "          rule.scale = (n and n > 0) and n or false",
  "        end",
  "        local transform = last_field(fields, \"transform\")",
  "        if transform then",
  "          local t = scalar_text(transform, locals)",
  "          rule.transform = (t and t:match(\"^[0-7]$\")) and tonumber(t) or 0",
  "        end",
  "        local mode = last_field(fields, \"mode\")",
  "        if mode then",
  "          local m = scalar_text(mode, locals)",
  "          if m and m ~= \"\" then rule.mode = m end",
  "        end",
  "      end",
  "    end",
  "  end",
  "  return rules",
  "end",
  "",
  "-- Hyprland's CMonitor::matchesStaticSelector.",
  "local function matches(output, out)",
  "  if output:sub(1, 5) == \"desc:\" then",
  "    local sel = trim(output:sub(6))",
  "    return sel ~= \"\" and (out.description or \"\"):sub(1, #sel) == sel",
  "  end",
  "  return output == out.name",
  "end",
  "",
  "-- scale (number or nil), transform, mode for one output from monitors.lua.",
  "local function resolve(out, rules)",
  "  local best = nil",
  "  for output, rule in pairs(rules) do",
  "    if output ~= \"\" and matches(output, out) and (not best or rule.rank > best.rank) then best = rule end",
  "  end",
  "  local base = best or rules[\"\"]",
  "  local scale = base and type(base.scale) == \"number\" and base.scale or nil",
  "  local transform = base and type(base.transform) == \"number\" and base.transform or 0",
  "  local mode = base and base.mode or \"preferred\"",
  "  return scale, transform, mode",
  "end",
  "",
  "local function integral(x)",
  "  return x == math.floor(x + 0.5)",
  "end",
  "",
  "-- The scale Hyprland 0.56 settles on: the nearest one, in 1/120 steps, that",
  "-- divides the mode into whole logical pixels (Monitor.cpp, applyMonitorRule).",
  "local function valid_scale(s, w, h)",
  "  if integral(w / s) and integral(h / s) then return s end",
  "  local search = math.floor(s * 120 + 0.5)",
  "  local zero = search / 120",
  "  if integral(w / zero) and integral(h / zero) then return zero end",
  "  for i = 1, 89 do",
  "    local up, down = (search + i) / 120, (search - i) / 120",
  "    if integral(w / up) and integral(h / up) then return up end",
  "    if down > 0 and integral(w / down) and integral(h / down) then return down end",
  "  end",
  "  return s",
  "end",
  "",
  "-- Logical size: the mode (a literal in monitors.lua, else the size recorded",
  "-- at the click), turned by the transform, divided by the scale, rounded.",
  "local function logical_size(out, scale, transform, mode)",
  "  local w, h = mode:match(\"^(%d+)x(%d+)\")",
  "  w, h = tonumber(w) or out.width, tonumber(h) or out.height",
  "  if transform % 2 == 1 then w, h = h, w end",
  "  local s = scale or out.fallback_scale or 1",
  "  s = valid_scale(s, w, h)",
  "  return { w = math.floor(w / s + 0.5), h = math.floor(h / s + 0.5) }",
  "end",
  "",
  "local function half(n)",
  "  return n // 2",
  "end",
  "",
  "-- Positions for a tile from logical sizes; the same maths as Model.js place().",
  "local function place(kind, L, order, sizes)",
  "  local p = {}",
  "  local a, b = order[1], order[2]",
  "  if kind == \"above\" or kind == \"mirror\" then",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = half(sizes[L].w - sizes[a].w), y = -sizes[a].h }",
  "  elseif kind == \"below\" then",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = half(sizes[L].w - sizes[a].w), y = sizes[L].h }",
  "  elseif kind == \"left\" then",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = -sizes[a].w, y = half(sizes[L].h - sizes[a].h) }",
  "  elseif kind == \"right\" then",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = sizes[L].w, y = half(sizes[L].h - sizes[a].h) }",
  "  elseif kind == \"row\" then",
  "    local x = 0",
  "    for _, k in ipairs(order) do",
  "      p[k] = { x = x, y = half(sizes[L].h - sizes[k].h) }",
  "      x = x + sizes[k].w",
  "    end",
  "    local shift = p[L].x",
  "    for _, k in ipairs(order) do p[k].x = p[k].x - shift end",
  "  elseif kind == \"pair-above\" then",
  "    local x = half(sizes[L].w - (sizes[a].w + sizes[b].w))",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = x, y = -sizes[a].h }",
  "    p[b] = { x = x + sizes[a].w, y = -sizes[b].h }",
  "  elseif kind == \"above-left\" or kind == \"above-right\" then",
  "    p[L] = { x = 0, y = 0 }",
  "    p[a] = { x = half(sizes[L].w - sizes[a].w), y = -sizes[a].h }",
  "    p[b] = { x = kind == \"above-left\" and -sizes[b].w or sizes[L].w, y = 0 }",
  "  elseif kind == \"off\" or kind == \"off-row\" or kind == \"ext-row\" then",
  "    local x, bottom = 0, 0",
  "    local first = sizes[order[1]]",
  "    for _, k in ipairs(order) do",
  "      local y = half(first.h - sizes[k].h)",
  "      p[k] = { x = x, y = y }",
  "      x = x + sizes[k].w",
  "      if y + sizes[k].h > bottom then bottom = y + sizes[k].h end",
  "    end",
  "    if L then p[L] = { x = half(x - sizes[L].w), y = bottom } end",
  "  elseif kind == \"ext-stack\" then",
  "    p[a] = { x = 0, y = 0 }",
  "    p[b] = { x = half(sizes[a].w - sizes[b].w), y = sizes[a].h }",
  "  else",
  "    return nil",
  "  end",
  "  return p",
  "end",
  "",
  "local function apply(arrangement)",
  "  local home = os.getenv(\"HOME\") or \"\"",
  "  local lines = read_lines(home .. \"/.config/hypr/monitors.lua\") or {}",
  "  local ok, rules = pcall(function() return parse_rules(lines, parse_locals(lines)) end)",
  "  if not ok then rules = {} end",
  "  local sizes, resolved = {}, {}",
  "  for _, out in ipairs(arrangement.outputs) do",
  "    local scale, transform, mode = resolve(out, rules)",
  "    resolved[out.output] = { scale = scale, transform = transform, mode = mode }",
  "    sizes[out.output] = logical_size(out, scale, transform, mode)",
  "  end",
  "  local positions = place(arrangement.kind, arrangement.laptop, arrangement.order, sizes)",
  "  if not positions then return end",
  "  for _, out in ipairs(arrangement.outputs) do",
  "    local r = resolved[out.output]",
  "    local pos = positions[out.output]",
  "    local rule = { output = out.output, mode = r.mode, position = string.format(\"%dx%d\", pos.x, pos.y) }",
  "    if r.scale then rule.scale = r.scale end",
  "    if r.transform ~= 0 then rule.transform = r.transform end",
  "    hl.monitor(rule)",
  "  end",
  "end",
  "",
  "local arrangement = sets[last]",
  "if arrangement then apply(arrangement) end"
].join("\n")

function luaTable(entries, indent) {
  return "{\n" + entries.map(function(e) { return indent + "  " + e + "," }).join("\n") + "\n" + indent + "}"
}

// Text of ~/.config/hypr/display-arrangement.lua for a tile: the arrangement
// (kind and order) and, per display, its output key, connector name,
// description and pixel size. No transform, mode or position is stored, and a
// scale only as the fallback for a display monitors.lua gives none; the loader
// derives the rest at config load. `sets` is keyed by the connected
// set so per-set memory can keep several entries later; today the file holds
// only the last click.
function fileText(tile, displays, opts) {
  opts = opts || {}
  var laptop = laptopOf(displays)
  var set = setKey(displays)

  var outputEntries = displays.map(function(d) {
    var px = modePixels(d)
    var fields = [
      "output = " + luaString(d.key),
      "name = " + luaString(d.name),
      "description = " + luaString(d.description),
      "width = " + px.w,
      "height = " + px.h
    ]
    if (d.isLaptop) fields.push("laptop = true")
    // Only when monitors.lua gives this display no scale: what it ran at when
    // clicked, so the loader's positions match the eval's.
    if (!d.scaleKnown) fields.push("fallback_scale = " + scaleKey(d.scale))
    return "{ " + fields.join(", ") + " }"
  })

  var arrangementFields = [
    "format = " + FORMAT_VERSION,
    "arrangement = " + luaString(tile.id),
    "mode = " + luaString(tile.mode),
    "kind = " + luaString(tile.spec.kind),
    "laptop = " + (laptop ? luaString(laptop.key) : "nil"),
    "order = { " + tile.spec.order.map(luaString).join(", ") + " }",
    "-- Connected displays. width x height is the pixel size of the mode they run when\n" +
    "    -- monitors.lua names none. Scale, transform and mode are read from monitors.lua;\n" +
    "    -- fallback_scale (the scale at the click) is used only when it gives none.\n" +
    "    outputs = " + luaTable(outputEntries, "    ")
  ]

  var header = [
    "-- Display arrangement, written by the jordi-adame.display-arranger bar widget.",
    "-- Loaded by require(\"hypr.display-arrangement\") at the end of monitors.lua, so these",
    "-- rules override monitors.lua for the outputs below. The next tile click replaces this",
    "-- whole file. Do not edit by hand.",
    "-- Scales, transforms and modes are not stored here: the loader reads them from",
    "-- monitors.lua (Omarchy's Display panel writes there) and computes the positions.",
    "-- A display whose scale monitors.lua does not give keeps the scale it had at the click.",
    "-- Laptop off and mirror are Omarchy toggles applied after this file; see the plugin README.",
    "-- display-arranger-format: " + FORMAT_VERSION,
    opts.writtenAt ? "-- written: " + String(opts.writtenAt).replace(/[^0-9TZ:.+-]/g, "") : null
  ].filter(function(l) { return l !== null }).join("\n")

  return header + "\n\n" +
    "-- One entry per connected set. Today only the last click is kept.\n" +
    "local last = " + luaString(set) + "\n" +
    "local sets = {\n" +
    "  [" + luaString(set) + "] = " + luaTable(arrangementFields, "  ") + ",\n" +
    "}\n\n" +
    LOADER + "\n"
}

// Everything apply.sh needs for one click.
function applyPlan(tile, displays, opts) {
  return {
    mode: tile.mode,
    luaText: fileText(tile, displays, opts),
    // Laptop off: the externals' rules, used only when Omarchy's laptop-off
    // toggle is already on (it would not reload again). Mirror: none.
    evalExpr: tile.mode === "normal" ? evalExpression(tile, displays)
      : (tile.mode === "laptop-off" ? evalExpression(tile, displays, { externalsOnly: true }) : ""),
    evalExprLidClosed: tile.mode === "normal" ? evalExpression(tile, displays, { keepLaptopState: true }) : ""
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    FORMAT_VERSION: FORMAT_VERSION,
    shortBrand: shortBrand,
    diagonalInches: diagonalInches,
    baseLabel: baseLabel,
    labelsFor: labelsFor,
    captionForms: captionForms,
    fitCaption: fitCaption,
    CAPTION_MIN_PX: CAPTION_MIN_PX,
    OVERLAY_MIN_PX: OVERLAY_MIN_PX,
    removesOutput: removesOutput,
    validScale: validScale,
    scaleKey: scaleKey,
    parseMonitors: parseMonitors,
    liveSignature: liveSignature,
    parseConfig: parseConfig,
    resolveDisplay: resolveDisplay,
    configuredDisplays: configuredDisplays,
    logicalSize: logicalSize,
    place: place,
    specs: specs,
    catalog: catalog,
    emptyReason: emptyReason,
    currentTileId: currentTileId,
    tileLabel: tileLabel,
    luaString: luaString,
    evalExpression: evalExpression,
    fileText: fileText,
    applyPlan: applyPlan,
    sizesFor: sizesFor,
    LOADER: LOADER
  }
}
