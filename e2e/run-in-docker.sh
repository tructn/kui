#!/usr/bin/env bash
# Entry point of the e2e container: build the app, then run backend and UI tests
# against the Kafka service from docker-compose.yml.
set -euo pipefail
cd /app

echo "▶ Building KUI (debug)…"
# VITE_E2E records every command the UI sends, so specs can assert none changed anything.
VITE_E2E=1 bun run tauri build --debug --no-bundle

echo "▶ Rust unit + integration tests against ${KAFKA_BOOTSTRAP}…"
(cd src-tauri && KUI_TEST_BOOTSTRAP="$KAFKA_BOOTSTRAP" cargo test -- --include-ignored)

echo "▶ UI end-to-end tests…"
cd e2e
# WebKit needs a display and a session bus, even when nobody is watching.
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
  dbus-run-session -- bun run test
