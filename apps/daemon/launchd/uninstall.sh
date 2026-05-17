#!/usr/bin/env bash
# Uninstall the splitlens-daemon LaunchAgent — unload from launchd and remove
# the plist (which contains the user's passwords). Run from anywhere:
#   bash apps/daemon/launchd/uninstall.sh
set -euo pipefail

LABEL="in.splitlens.daemon"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

if launchctl list "$LABEL" >/dev/null 2>&1; then
  launchctl unload "$TARGET" 2>/dev/null || true
fi

if [[ -f "$TARGET" ]]; then
  rm -f "$TARGET"
  echo "Removed $TARGET"
else
  echo "No plist at $TARGET — nothing to remove."
fi
