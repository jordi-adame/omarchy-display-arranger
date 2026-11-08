-- Test runner: loads a Lua config file (a generated display-arrangement.lua, or
-- a monitors.lua that requires it) with a stub `hl` and prints every
-- hl.monitor call as one JSON object per line.
local calls = {}
hl = {
  monitor = function(rule) calls[#calls + 1] = rule end,
  env = function() end,
}
-- Like Omarchy's bootstrap, so monitors.lua can require("hypr.display-arrangement").
package.path = (os.getenv("HOME") or "") .. "/.config/?.lua;" .. package.path

dofile(arg[1])

local function json_string(s)
  return '"' .. tostring(s):gsub('[%c"\\]', function(c)
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local keys = { "output", "mode", "position", "scale", "transform", "disabled", "mirror" }
for _, rule in ipairs(calls) do
  local parts = {}
  for _, key in ipairs(keys) do
    local value = rule[key]
    if value ~= nil then
      if type(value) == "string" then
        parts[#parts + 1] = json_string(key) .. ":" .. json_string(value)
      else
        parts[#parts + 1] = json_string(key) .. ":" .. tostring(value)
      end
    end
  end
  print("{" .. table.concat(parts, ",") .. "}")
end
