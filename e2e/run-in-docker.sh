#!/usr/bin/env bash
# Entry point of the e2e container: build the app, then run backend and UI tests
# against the Kafka service from docker-compose.yml.
set -euo pipefail
cd /app

if [[ -n "${E2E_HEADED:-}" ]]; then
  # A display that outlives each app session, so the run can be watched over VNC. It has no
  # window manager, so paint the bare root and label it; otherwise the gaps between specs
  # look like a broken black screen.
  export DISPLAY=:99
  Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
  for _ in {1..50}; do [[ -e /tmp/.X11-unix/X99 ]] && break; sleep 0.1; done
  xsetroot -solid '#3b4252'
  xmessage -geometry -40-40 -buttons '' \
    "KUI e2e: each spec opens the app here. Between specs this screen is empty." &
  echo "▶ The VNC viewer opens when the UI tests start (vnc://localhost:5900, password kui)"
fi

echo "▶ Building KUI (debug)…"
# VITE_E2E records every command the UI sends, so specs can assert none changed anything.
VITE_E2E=1 bun run tauri build --debug --no-bundle

echo "▶ Building the example .NET Lambda…"
dotnet build examples/order-lambda/src/OrderLambda -c Release --nologo -v quiet

cd e2e
shopt -s nullglob
spec_args=()
# Sorted like wdio's own glob, so the last entry is the spec that runs last.
specs=(specs/*.e2e.ts)
if [[ -n "${E2E_SPEC:-}" ]]; then
  specs=(specs/*"$E2E_SPEC"*.e2e.ts)
  if ((${#specs[@]} == 0)); then
    echo "No spec in e2e/specs matches \"$E2E_SPEC\"" >&2
    exit 1
  fi
  for spec in "${specs[@]}"; do spec_args+=(--spec "./$spec"); done
  echo "▶ Skipping the Rust tests: running only ${specs[*]}"
else
  echo "▶ Rust unit + integration tests against ${KAFKA_BOOTSTRAP}…"
  (cd .. && KUI_TEST_BOOTSTRAP="$KAFKA_BOOTSTRAP" cargo test -p kui_desktop -- --include-ignored)
fi

echo "▶ UI end-to-end tests…"
# WebKit needs a display and a session bus, even when nobody is watching.
ui=(dbus-run-session -- bun run test "${spec_args[@]}")
if [[ -n "${E2E_HEADED:-}" ]]; then
  # Shared only now, so the viewer `make e2e-headed` opens on connect shows the app, not the build.
  x11vnc -display :99 -rfbport 5900 -passwd kui -forever -shared -quiet -bg -o /tmp/x11vnc.log
  E2E_HOLD_SPEC="$(basename "${specs[-1]}")" "${ui[@]}"
else
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" "${ui[@]}"
fi
