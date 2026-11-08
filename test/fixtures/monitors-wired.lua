-- Test fixture: the same monitors.lua wired for the plugin: the hand desc: rules before the
-- catch-all, the laptop rule after it, and the require line apply.sh appends kept last.
-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))

-- Laptop panel at the origin (0x0), like the io.github.jordi-adame.display-arranger bar widget: external
-- Northwind 4K (serial DEMO00000742) centered above the panel; second external Northwind 4K
-- (serial DEMO00000519) right of the panel, top edges aligned.
-- Matched by serial, not DP-1/DP-2: those names follow port and plug order.
-- The external is 1920x1080 logical at scale 2. The laptop panel follows the Display panel's
-- scale buttons (omarchy_monitor_scale above); "auto" picks 1.5 on this 1920x1200 panel, so the
-- position math reads it as 1.5.
-- These two rules sit before the catch-all on purpose. Omarchy's Display panel persists an
-- external's scale as a rule by connector name right after the catch-all
-- (hl.monitor({ output = "DP-1", ... scale = 2 })). Hyprland applies the last rule that
-- matches a monitor, so a rule placed later wins: with the hand rules here, the Display
-- panel's rule comes later and its scale sticks. The hand rules only set the default (2)
-- and the fallback positions for a display the arranger's file does not name.
local panel_scale = tonumber(omarchy_monitor_scale) or 1.5
local panel_width = math.floor(1920 / panel_scale)
local panel_x = math.floor((1920 - panel_width) / 2)
hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "3840x2160@60", position = string.format("%dx-1080", math.floor((panel_width - 1920) / 2)), scale = 2 })
hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000519", mode = "3840x2160@60", position = string.format("%dx0", panel_width), scale = 2 })

hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })

-- The laptop panel's own rule. The Display panel's scale buttons edit its scale in place;
-- Omarchy's clamshell script reads its position (0x0) and scale back from here.
hl.monitor({ output = "eDP-1", mode = "preferred", position = "0x0", scale = omarchy_monitor_scale })

-- Display arrangement from the io.github.jordi-adame.display-arranger bar widget. Keep this the last line.
require("hypr.display-arrangement")
