#!/bin/bash
# Applies one display arrangement chosen in the jordi-adame.display-arranger popup.
#
#   apply.sh [--dry-run] apply <normal|laptop-off|mirror> <lua-text> <eval-expr> <eval-expr-lid-closed>
#
# The Lua text is the whole of ~/.config/hypr/display-arrangement.lua; the
# eval expressions hold one hl.monitor call per connected display (only for
# "normal"). All of them come from Model.js; nothing here builds Lua.
#
# The file stores no scale, transform, mode or position: its loader
# reads those from monitors.lua at config load. So the file written here is the
# same whether or not Omarchy's mirror or laptop-off toggle is on at the click,
# and writing it before the toggle is lifted (below) cannot persist a stale
# state; it only saves one visible move (the reload the toggle command runs
# applies the new file at once).
#
# After a successful write the script wires monitors.lua: when
# ~/.config/hypr/monitors.lua exists and has no require of
# hypr.display-arrangement, it copies it to monitors.lua.bak.<stamp> and
# appends a comment plus require("hypr.display-arrangement") at the end, once,
# atomically (tmp + mv). Hyprland reloads on that write and loads the file
# from then on. A hand-written require line counts; a commented-out one does
# not. A missing or read-only monitors.lua is left alone and the popup is told
# (a "notice:" line on stdout). The wiring is logged and announced once with
# notify-send.
#
# Dry run (prints what it would run and write, changes nothing): pass
# --dry-run, set DISPLAY_ARRANGER_DRY_RUN=1, or put a file named DRY_RUN next
# to this script.
#
# The popup must be closed before laptop-off or mirror: both take
# an output away, and while an Omarchy KeyboardPanel popup is open on the
# output that goes, the shell re-creates the panel's dismiss twin on the dying
# screen and crashes (see the README). Panel.qml closes the popup and waits for its
# window to unmap before running this script for those modes, and tells it
# through DISPLAY_ARRANGER_POPUP_OPEN. "1" refuses the output-removing modes
# before anything is written or run; "normal" clicks are unaffected.
#
# Tests point the commands and paths elsewhere with the DISPLAY_ARRANGER_*
# variables below.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HYPRCTL="${DISPLAY_ARRANGER_HYPRCTL:-hyprctl}"
INTERNAL_CMD="${DISPLAY_ARRANGER_INTERNAL_CMD:-omarchy-hyprland-monitor-internal}"
MIRROR_CMD="${DISPLAY_ARRANGER_MIRROR_CMD:-omarchy-hyprland-monitor-internal-mirror}"
TARGET="${DISPLAY_ARRANGER_TARGET:-$HOME/.config/hypr/display-arrangement.lua}"
TOGGLES_DIR="${DISPLAY_ARRANGER_TOGGLES_DIR:-$HOME/.local/state/omarchy/toggles/hypr}"
MONITORS_LUA="${DISPLAY_ARRANGER_MONITORS_LUA:-$HOME/.config/hypr/monitors.lua}"
NOTIFY_CMD="${DISPLAY_ARRANGER_NOTIFY_CMD:-notify-send}"
LOG_DIR="${DISPLAY_ARRANGER_LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/display-arranger}"

DISABLE_FLAG="$TOGGLES_DIR/internal-monitor-disable.lua"
MIRROR_FLAG="$TOGGLES_DIR/internal-monitor-mirror.lua"
CLAMSHELL_FLAG="$TOGGLES_DIR/internal-monitor-clamshell.lua"

# What wire_monitors_lua appends, and how it recognises a require of the file
# (outside a comment, with or without parentheses, double or single quotes).
REQUIRE_LINE='require("hypr.display-arrangement")'
REQUIRE_COMMENT='-- Display arrangement from the jordi-adame.display-arranger bar widget. Keep this the last line.'
REQUIRE_PATTERN='^[[:space:]]*require[[:space:]]*\(?[[:space:]]*["'"'"']hypr\.display-arrangement["'"'"']'

dry_run=0
if [[ ${1:-} == --dry-run ]]; then
  dry_run=1
  shift
fi
[[ ${DISPLAY_ARRANGER_DRY_RUN:-} == 1 ]] && dry_run=1
[[ -f $script_dir/DRY_RUN ]] && dry_run=1

log() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$*" >>"$LOG_DIR/apply.log" 2>/dev/null || true
}

say() {
  printf '%s\n' "$*"
  log "$*"
}

fail() {
  printf 'display-arranger: %s\n' "$*" >&2
  log "error: $*"
  exit 1
}

# Something the popup should show without failing the click (Panel.qml picks
# up the first "notice:" line of stdout).
notice() {
  say "notice: $*"
}

# Runs an Omarchy toggle command, or in a dry run prints it. A refusal (the
# command exits non-zero) fails the click, so the popup never reports success
# while the toggle is still in place.
run() {
  local out
  if (( dry_run )); then
    say "dry-run: would run: $(printf '%q ' "$@")"
    return 0
  fi
  log "run: $(printf '%q ' "$@")"
  out="$("$@" 2>&1)" || fail "$(basename "$1") ${2:-} failed: ${out//$'\n'/ }"
}

# Atomic write: a temp file beside the target, renamed over it in one step,
# so Hyprland (which reloads on config writes) never reads half a file.
write_target() {
  local text="$1" dir tmp

  if (( dry_run )); then
    say "dry-run: would write $TARGET (atomic, tmp + mv):"
    printf '%s' "$text"
    wire_monitors_lua
    return 0
  fi

  dir="$(dirname "$TARGET")"
  mkdir -p "$dir" || fail "cannot create $dir"
  tmp="$(mktemp "$TARGET.XXXXXX")" || fail "cannot create a temp file next to $TARGET"
  if ! printf '%s' "$text" >"$tmp"; then
    rm -f "$tmp"
    fail "cannot write $tmp"
  fi
  # Refuse Lua that does not even parse, when a Lua compiler is at hand.
  if command -v luac >/dev/null 2>&1 && ! luac -p "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    fail "generated Lua does not parse; $TARGET left unchanged"
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$TARGET" || { rm -f "$tmp"; fail "cannot move $tmp to $TARGET"; }
  log "wrote $TARGET"
  wire_monitors_lua
}

# Makes monitors.lua load the file written above: appends the require line
# (with its comment) once, at the end, after a timestamped backup, through a
# temp file renamed over the original. Idempotent: a monitors.lua that already
# requires the file is never touched. A missing or read-only file is left
# alone and the popup is told; this never fails the click, which has already
# been applied live.
wire_monitors_lua() {
  local target="$MONITORS_LUA" dir stamp backup tmp
  if [[ ! -f $target ]]; then
    notice "monitors.lua not found at $target; add $REQUIRE_LINE at its end yourself so the arrangement survives a reload"
    return 0
  fi
  if grep -Eq "$REQUIRE_PATTERN" "$target"; then
    (( dry_run )) && say "dry-run: $target already requires hypr.display-arrangement; nothing to add"
    return 0
  fi
  dir="$(dirname "$target")"
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="$target.bak.$stamp"
  if (( dry_run )); then
    say "dry-run: would copy $target to $backup and append to $target:"
    printf '%s\n%s\n' "$REQUIRE_COMMENT" "$REQUIRE_LINE"
    return 0
  fi
  if [[ ! -w $target || ! -w $dir ]]; then
    notice "monitors.lua is not writable ($target); add $REQUIRE_LINE at its end yourself"
    return 0
  fi
  if ! cp -p -- "$target" "$backup"; then
    notice "could not back up monitors.lua to $backup; left unchanged"
    return 0
  fi
  if ! tmp="$(mktemp "$target.XXXXXX")"; then
    notice "could not create a temp file next to monitors.lua; left unchanged"
    return 0
  fi
  if ! {
    cat -- "$target"
    # End an unterminated last line first, then a blank line, the comment and the require.
    if [[ -s $target && $(tail -c 1 -- "$target" | wc -l) -eq 0 ]]; then printf '\n'; fi
    printf '\n%s\n%s\n' "$REQUIRE_COMMENT" "$REQUIRE_LINE"
  } >"$tmp"; then
    rm -f "$tmp"
    notice "could not write $tmp; monitors.lua left unchanged"
    return 0
  fi
  chmod --reference="$target" "$tmp" 2>/dev/null || chmod 644 "$tmp"
  if ! mv -f -- "$tmp" "$target"; then
    rm -f "$tmp"
    notice "could not replace monitors.lua; left unchanged (backup: $backup)"
    return 0
  fi
  log "wired $target (backup $backup)"
  notice "Added $REQUIRE_LINE to monitors.lua so the arrangement survives a reload (backup: $backup)"
  if command -v "$NOTIFY_CMD" >/dev/null 2>&1; then
    "$NOTIFY_CMD" "Display arranger" "monitors.lua now loads the arrangement file (backup: monitors.lua.bak.$stamp)" >/dev/null 2>&1 || true
  fi
}

# hyprctl eval prints "ok" on success; anything else is Hyprland's error.
eval_live() {
  local expr="$1" out
  if (( dry_run )); then
    say "dry-run: would run: $HYPRCTL eval $(printf '%q' "$expr")"
    return 0
  fi
  log "run: $HYPRCTL eval $expr"
  out="$("$HYPRCTL" eval "$expr" 2>&1)" || fail "hyprctl eval failed: $out"
  [[ -z $out || $out == ok* ]] || fail "hyprctl eval: $out"
}

apply_normal() {
  local lua="$1" expr="$2" expr_lid_closed="$3"
  [[ -n $expr ]] || fail "missing eval expression"

  # Lid shut while docked: keep the laptop off, as Omarchy's clamshell wants.
  [[ -f $CLAMSHELL_FLAG && -n $expr_lid_closed ]] && expr="$expr_lid_closed"

  if [[ -f $MIRROR_FLAG || -f $DISABLE_FLAG ]]; then
    # Omarchy's toggles load after this file and would win, so lift them.
    # Each one reloads Hyprland synchronously, which applies the new file when
    # monitors.lua requires it; the eval afterwards covers a monitors.lua that
    # is not wired. The file holds no live state, so writing it first is safe
    # and saves one visible move.
    write_target "$lua"
    [[ -f $MIRROR_FLAG ]] && run "$MIRROR_CMD" off
    [[ -f $DISABLE_FLAG ]] && run "$INTERNAL_CMD" on
    eval_live "$expr"
    return 0
  fi

  # Live first: if Hyprland rejects the rules, the persisted file stays as it was.
  eval_live "$expr"
  write_target "$lua"
}

apply_laptop_off() {
  local lua="$1" expr="$2"
  write_target "$lua"
  # Omarchy refuses to turn the laptop off while mirroring.
  [[ -f $MIRROR_FLAG ]] && run "$MIRROR_CMD" off
  # Omarchy's toggle reloads Hyprland (a no-op when the laptop is already
  # off); the externals' rules are then evaled live, which also covers a
  # monitors.lua that is not wired.
  [[ -f $DISABLE_FLAG ]] || run "$INTERNAL_CMD" off
  [[ -n $expr ]] && eval_live "$expr"
  return 0
}

apply_mirror() {
  local lua="$1"
  write_target "$lua"
  # Omarchy's mirror toggle lifts its own laptop-off flag first.
  run "$MIRROR_CMD" on
}

action="${1:-}"
case "$action" in
apply)
  mode="${2:-}"
  lua="${3:-}"
  expr="${4:-}"
  expr_lid_closed="${5:-}"
  [[ -n $lua ]] || fail "missing Lua text"
  if [[ ${DISPLAY_ARRANGER_POPUP_OPEN:-0} == 1 && ( $mode == mirror || $mode == laptop-off ) ]]; then
    fail "the popup is still open; $mode takes an output away and would crash the shell (close the popup first)"
  fi
  (( dry_run )) && say "dry-run: mode $mode, target $TARGET"
  case "$mode" in
  normal) apply_normal "$lua" "$expr" "$expr_lid_closed" ;;
  laptop-off) apply_laptop_off "$lua" "$expr" ;;
  mirror) apply_mirror "$lua" ;;
  *) fail "unknown mode: $mode" ;;
  esac
  ;;
*)
  echo "Usage: apply.sh [--dry-run] apply <normal|laptop-off|mirror> <lua-text> <eval-expr> <eval-expr-lid-closed>" >&2
  exit 2
  ;;
esac
