-- Test fixture: a hand-written monitors.lua from before the plugin, with the desc: rules
-- after the catch-all (the order the wired fixture corrects). Made-up displays.
-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })

-- External Northwind 4K (serial DEMO00000742) above the laptop panel, panel centered under it;
-- second external Northwind 4K (serial DEMO00000519) right of the panel, top edges aligned.
-- Matched by serial, not DP-1/DP-2: those names follow port and plug order.
-- The external is 1920x1080 logical at scale 2. The laptop panel follows the Display panel's
-- scale buttons (omarchy_monitor_scale above); "auto" picks 1.5 on this 1920x1200 panel, so the
-- position math reads it as 1.5.
local panel_scale = tonumber(omarchy_monitor_scale) or 1.5
local panel_width = math.floor(1920 / panel_scale)
local panel_x = math.floor((1920 - panel_width) / 2)
hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000742", mode = "3840x2160@60", position = "0x0", scale = 2 })
hl.monitor({ output = "eDP-1", mode = "preferred", position = string.format("%dx1080", panel_x), scale = omarchy_monitor_scale })
hl.monitor({ output = "desc:Northwind Corporation NW-1560 DEMO00000519", mode = "3840x2160@60", position = string.format("%dx1080", panel_x + panel_width), scale = 2 })
