#!/usr/bin/env bash
# Install the splitlens-daemon LaunchAgent.
#
# Asks for each PDF password interactively (so they don't end up in shell
# history), substitutes them + the local node/pnpm paths into the plist
# template, and loads the agent via launchctl.
#
# Run from anywhere:
#   bash apps/daemon/launchd/install.sh
# or via pnpm:
#   pnpm --filter @splitlens/daemon install-launchd
set -euo pipefail

LABEL="in.splitlens.daemon"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/$LABEL.plist"
LOGS_DIR="$REPO_ROOT/apps/daemon/logs"

NODE_BIN="$(command -v node || true)"
PNPM_BIN="$(command -v pnpm || true)"

if [[ -z "$NODE_BIN" || -z "$PNPM_BIN" ]]; then
  echo "ERROR: node and/or pnpm not found on PATH. Install them, then retry." >&2
  exit 1
fi

read -rsp "PhonePe PDF password: "    PHONEPE_PWD; echo
read -rsp "HDFC savings PDF password: " HDFC_PWD; echo
read -rsp "HDFC CC PDF password: "    HDFC_CC_PWD; echo

mkdir -p "$TARGET_DIR" "$LOGS_DIR"

# Bail out if launchd already has it loaded — uninstall first.
if launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "Unloading existing $LABEL …"
  launchctl unload "$TARGET" 2>/dev/null || true
fi

sed \
  -e "s|@REPO_ROOT@|$REPO_ROOT|g" \
  -e "s|@NODE_BIN@|$NODE_BIN|g" \
  -e "s|@PNPM_BIN@|$PNPM_BIN|g" \
  -e "s|@PHONEPE_PWD@|$PHONEPE_PWD|g" \
  -e "s|@HDFC_PWD@|$HDFC_PWD|g" \
  -e "s|@HDFC_CC_PWD@|$HDFC_CC_PWD|g" \
  "$TEMPLATE" > "$TARGET"

chmod 600 "$TARGET"   # plist contains passwords — lock down read access

launchctl load "$TARGET"
echo "Loaded $LABEL — tail $LOGS_DIR/daemon.out.log to see activity."
