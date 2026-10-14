#!/usr/bin/env bash
# Sets the app version everywhere it's stored: package.json (which Tauri reads),
# src-tauri/Cargo.toml and src-tauri/Cargo.lock. See "Releasing" in CONTRIBUTING.md.
# Usage: scripts/set-version.sh 0.2.0
set -euo pipefail

version=${1:-}
# Numeric only: the Windows MSI format rejects pre-release suffixes like -beta.1.
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Usage: $0 X.Y.Z" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
VERSION=$version perl -pi -e 's/^(  "version": )"[^"]*"/$1"$ENV{VERSION}"/' package.json
VERSION=$version perl -0pi -e 's/(\[package\]\nname = "kui"\nversion = )"[^"]*"/$1"$ENV{VERSION}"/' src-tauri/Cargo.toml
VERSION=$version perl -0pi -e 's/(name = "kui"\nversion = )"[^"]*"/$1"$ENV{VERSION}"/' src-tauri/Cargo.lock

git diff --stat -- package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
