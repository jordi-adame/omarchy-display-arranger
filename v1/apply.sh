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
LOG_DIR="${DISPLAY_ARRANGER_LOG_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/display-arranger}"

DISABLE_FLAG="$TOGGLES_DIR/internal-monitor-disable.lua"
MIRROR_FLAG="$TOGGLES_DIR/internal-monitor-mirror.lua"
CLAMSHELL_FLAG="$TOGGLES_DIR/internal-monitor-clamshell.lua"

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

# Runs a command, or in a dry run prints it.
run() {
  if (( dry_run )); then
    say "dry-run: would run: $(printf '%q ' "$@")"
    return 0
  fi
  log "run: $(printf '%q ' "$@")"
  "$@"
}

# Atomic write: a temp file beside the target, renamed over it in one step,
# so Hyprland (which reloads on config writes) never reads half a file.
write_target() {
  local text="$1" dir tmp

  if (( dry_run )); then
    say "dry-run: would write $TARGET (atomic, tmp + mv):"
    printf '%s' "$text"
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

  if [[ -f $MIRROR_FLAG || -f $DISABLE_FLAG ]]; then
    # Omarchy's toggles load after this file and would win, so lift them.
    # Each one reloads Hyprland, which applies the new file; no eval needed.
    # The file holds no live state (see the header), so writing it first is
    # safe: the reload for the toggle applies the configured scales.
    write_target "$lua"
    [[ -f $MIRROR_FLAG ]] && run "$MIRROR_CMD" off
    [[ -f $DISABLE_FLAG ]] && run "$INTERNAL_CMD" on
    return 0
  fi

  # Lid shut while docked: keep the laptop off, as Omarchy's clamshell wants.
  [[ -f $CLAMSHELL_FLAG && -n $expr_lid_closed ]] && expr="$expr_lid_closed"

  # Live first: if Hyprland rejects the rules, the persisted file stays as it was.
  eval_live "$expr"
  write_target "$lua"
}

apply_laptop_off() {
  local lua="$1" expr="$2"
  write_target "$lua"
  # Omarchy refuses to turn the laptop off while mirroring.
  [[ -f $MIRROR_FLAG ]] && run "$MIRROR_CMD" off
  if [[ -f $DISABLE_FLAG ]]; then
    # Already off: Omarchy would do nothing, so apply the externals' rules live.
    [[ -n $expr ]] && eval_live "$expr"
    return 0
  fi
  run "$INTERNAL_CMD" off
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
