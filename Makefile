# Shortcuts for the bun scripts in package.json. On Windows, run make from Git Bash.
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c

BUNDLE := target/release/bundle

ifeq ($(OS),Windows_NT)
PLATFORM := windows
else ifeq ($(shell uname -s),Darwin)
PLATFORM := macos
else
PLATFORM := unsupported
endif

.PHONY: dev install package test e2e e2e-headed lint typecheck check

# Hot reload: Vite reloads UI changes, Tauri rebuilds and restarts on Rust changes.
dev: node_modules
	bun run tauri dev

# Installers for this OS only; output in target/release/bundle.
package: package-$(PLATFORM)

.PHONY: package-macos package-windows package-unsupported

package-macos: node_modules
	bun run package:mac

package-windows: node_modules
	bun run package:win

package-unsupported:
	@echo "make package supports macOS and Windows only" >&2; exit 1

test: node_modules
	bun run test

# Runs in Docker. SPEC=<part of a file name in e2e/specs> runs only those UI specs, without the Rust tests.
e2e:
	E2E_SPEC="$(SPEC)" bun run test:e2e

# Like e2e, shown live in a VNC viewer. On macOS, Screen Sharing opens when the UI tests start (after
# the build). SLOWMO=<ms> pauses after every WebDriver command (0 for full speed), and the last spec's
# app stays open until you press Enter. The port is only published on localhost.
VNC_URL := vnc://:kui@127.0.0.1:5900
SLOWMO ?= 250
e2e-headed:
	docker compose --profile e2e rm --stop --force kafka-e2e kafka-seed-e2e
	@# Docker accepts connections on a published port before anything listens behind it, so wait
	@# for x11vnc's RFB greeting rather than an open port.
	@viewer() { \
	  for _ in {1..7200}; do \
	    banner=$$( (read -r -t 2 -n 3 reply </dev/tcp/127.0.0.1/5900 && printf %s "$$reply") 2>/dev/null || true); \
	    if [[ $$banner == RFB ]]; then \
	      if command -v open >/dev/null; then open "$(VNC_URL)"; else echo "Connect a VNC viewer to $(VNC_URL)"; fi; \
	      return; \
	    fi; \
	    sleep 1; \
	  done; \
	}; \
	viewer & watcher=$$!; trap 'kill $$watcher 2>/dev/null || true' EXIT; \
	E2E_HEADED=1 E2E_SLOWMO="$(SLOWMO)" E2E_SPEC="$(SPEC)" \
	  docker compose --profile e2e run --build --rm -p 127.0.0.1:5900:5900 e2e

# Local Kafka on localhost:9092 with the demo topics from docker/kafka-seed.sh; add it in KUI as
# localhost:9092. `run` instead of `up` so the seed's output shows and a failed seed fails the target.
.PHONY: kafka kafka-down

kafka:
	docker compose up -d --wait kafka
	docker compose run --rm kafka-seed
	@echo "Kafka is ready on localhost:9092"

# The broker keeps no volume, so this also wipes everything produced to it.
kafka-down:
	docker compose down

# Runs the order Lambda example like a launch profile in Properties/launchSettings.json does in an IDE, and
# starts the Lambda Test Tool for it unless one already listens. PROFILE=<name> picks another profile.
# `dotnet run --launch-profile` ignores "Executable" profiles, so the profile is read with jq and run as is.
LAMBDA_DIR := examples/order-lambda/src/OrderLambda
LAMBDA_SETTINGS := $(LAMBDA_DIR)/Properties/launchSettings.json
PROFILE ?= KUI OrderProcessor (macOS, Linux)
CONFIGURATION ?= Debug
.PHONY: lambda

lambda:
	@profile=$$(jq -ce --arg p "$(PROFILE)" '.profiles[$$p]' "$(LAMBDA_SETTINGS)") || { \
	  echo "no launch profile \"$(PROFILE)\"; profiles in $(LAMBDA_SETTINGS):" >&2; \
	  jq -r '.profiles | keys[] | "  " + .' "$(LAMBDA_SETTINGS)" >&2; exit 1; }; \
	field() { jq -r "$$1" <<<"$$profile" | sed -e 's|\$$(Configuration)|$(CONFIGURATION)|g' \
	  -e "s|%HOME%|$${HOME:-}|g" -e "s|%USERPROFILE%|$${USERPROFILE:-}|g"; }; \
	dotnet build "$(LAMBDA_DIR)" --configuration "$(CONFIGURATION)"; \
	vars=(); while IFS= read -r var; do vars+=("$$var"); done \
	  < <(field '.environmentVariables // {} | to_entries[] | "\(.key)=\(.value)"'); \
	read -ra args <<<"$$(field '.commandLineArgs')"; \
	api=$$(printf '%s\n' "$${vars[@]}" | sed -n 's/^AWS_LAMBDA_RUNTIME_API=//p'); \
	port=$${api%%/*}; port=$${port##*:}; \
	listening() { (: </dev/tcp/127.0.0.1/"$$port") 2>/dev/null; }; \
	if [[ -n $$port ]] && ! listening; then \
	  dotnet lambda-test-tool start --lambda-emulator-port "$$port" --no-launch-window & tool=$$!; \
	  trap 'kill $$tool 2>/dev/null || true' EXIT; \
	  for _ in {1..60}; do listening && break; sleep 1; done; \
	  listening || { echo "the Lambda Test Tool didn't start on port $$port" >&2; exit 1; }; \
	fi; \
	cd "$(LAMBDA_DIR)/$$(field '.workingDirectory')"; \
	echo "Running \"$(PROFILE)\"; in KUI, point the action at http://localhost:$$port"; \
	env "$${vars[@]}" "$$(field '.executablePath')" "$${args[@]}"

lint:
	bun run lint

typecheck: node_modules
	bunx tsc --noEmit

# Everything to run before calling a change done.
check: lint typecheck test

# Builds a release for this machine and installs it, replacing any installed KUI.
install: install-$(PLATFORM)

.PHONY: install-macos install-windows install-unsupported

install-macos: node_modules
	bun run tauri build --bundles app
	rm -rf /Applications/KUI.app
	cp -R $(BUNDLE)/macos/KUI.app /Applications/
	@echo "Installed /Applications/KUI.app"

# Runs the NSIS installer, which upgrades an existing install in place.
install-windows: node_modules
	bun run tauri build --bundles nsis
	installer=$$(ls -t $(BUNDLE)/nsis/*-setup.exe | head -n 1); "./$$installer"

install-unsupported:
	@echo "make install supports macOS and Windows only" >&2; exit 1

# Runs release.yml by hand on a pushed branch: it builds every platform's installers without releasing
# anything. GitHub builds what origin has, not your working tree. `gh run watch` can exit 0 when the API
# hiccups mid-run, so the result is checked before downloading. Ctrl-C stops watching, not the run;
# fetch its installers later with `make release-artifacts RUN=<id>`.
REF ?= $(shell git branch --show-current)
DRY_RUN_DIR := target/release-dry-run
# Not a `$(MAKE) release-artifacts` call: make runs any line containing $(MAKE) even under `make -n`, which
# would start a real run.
download_artifacts = rm -rf $(DRY_RUN_DIR) && gh run download "$(1)" --dir $(DRY_RUN_DIR) && \
	find $(DRY_RUN_DIR) -type f | sort

.PHONY: release-dry-run release-artifacts

release-dry-run:
	@git fetch --quiet origin "$(REF)"
	@local=$$(git rev-parse --verify --quiet "$(REF)" || true); \
	[ -z "$$local" ] || [ "$$local" = "$$(git rev-parse FETCH_HEAD)" ] || \
	  echo "warning: local $(REF) differs from origin/$(REF); GitHub builds origin/$(REF)" >&2
	@list() { gh run list --workflow release.yml --branch "$(REF)" --event workflow_dispatch --limit 1 \
	  --json databaseId --jq '.[0].databaseId // empty'; }; \
	before=$$(list); \
	gh workflow run release.yml --ref "$(REF)"; \
	run=; \
	for _ in {1..30}; do run=$$(list); [ -n "$$run" ] && [ "$$run" != "$$before" ] && break; run=; sleep 2; done; \
	[ -n "$$run" ] || { echo "the run didn't start; check gh run list --workflow release.yml" >&2; exit 1; }; \
	echo "Run $$run: $$(gh run view "$$run" --json url --jq .url)"; \
	gh run watch "$$run" --exit-status; \
	result=$$(gh run view "$$run" --json conclusion --jq .conclusion); \
	[ "$$result" = success ] || { \
	  echo "run $$run isn't a success ($${result:-still running}); once it is: make release-artifacts RUN=$$run" >&2; \
	  exit 1; }; \
	$(call download_artifacts,$$run)

release-artifacts:
	@[ -n "$(RUN)" ] || { echo "usage: make release-artifacts RUN=<run id>" >&2; exit 1; }
	$(call download_artifacts,$(RUN))

node_modules: package.json bun.lock
	bun install --frozen-lockfile
	@touch node_modules
