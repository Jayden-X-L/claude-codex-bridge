#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
BRIDGE_DIR="$SCRIPT_DIR"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
NODE_BIN="${NODE_BIN:-node}"

osascript -e 'tell application "System Events" to keystroke "c" using {command down}'
sleep 0.25

"$NODE_BIN" "$BRIDGE_DIR/bridge.mjs" to-codex --workspace "$WORKSPACE_DIR" --delivery current
