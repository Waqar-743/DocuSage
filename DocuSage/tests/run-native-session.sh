#!/usr/bin/env bash
set -euo pipefail
# Isolate test data and native credentials from the developer's profile.
export NATIVE_TEST_DIR="${NATIVE_TEST_DIR:-$(mktemp -d /tmp/docusage-native.XXXXXX)}"
export XDG_CONFIG_HOME="$NATIVE_TEST_DIR/config"
export XDG_DATA_HOME="$NATIVE_TEST_DIR/data"
export XDG_CACHE_HOME="$NATIVE_TEST_DIR/cache"
export MODEL_PATH="${MODEL_PATH:-/tmp/docusage-models}"
export DISPLAY="${NATIVE_TEST_DISPLAY:-:99}"
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
Xvfb "$DISPLAY" -screen 0 1440x1000x24 > /tmp/docusage-xvfb.log 2>&1 &
display_pid=$!
for attempt in {1..30}; do
  if xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
  sleep 0.1
done
cat > "$NATIVE_TEST_DIR/openbox.xml" <<'CONFIG'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc"><keyboard/><mouse/><applications/></openbox_config>
CONFIG
# This test desktop leaves Alt+Space available for DocuSage. A normal desktop
# may reserve it; the website documents changing the shortcut in that case.
openbox --config-file "$NATIVE_TEST_DIR/openbox.xml" > /tmp/docusage-openbox.log 2>&1 &
window_manager_pid=$!
printf 'docusage-test-fixture-password' | gnome-keyring-daemon --unlock --components=secrets > /tmp/docusage-keyring.log 2>&1
"${TAURI_DRIVER:-/tmp/docusage-cargo/bin/tauri-driver}" > /tmp/docusage-webdriver.log 2>&1 &
driver_pid=$!
trap 'kill "$driver_pid" "$window_manager_pid" "$display_pid" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:4444/status >/dev/null 2>&1; then break; fi
  sleep 0.1
done
node tests/native.mjs
