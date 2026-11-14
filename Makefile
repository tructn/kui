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

.PHONY: dev install package test test-e2e lint typecheck check

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

# Runs in Docker.
test-e2e:
	bun run test:e2e

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

node_modules: package.json bun.lock
	bun install --frozen-lockfile
	@touch node_modules
