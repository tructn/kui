# Contributing to KUI

## Development setup

Prerequisites: [Bun](https://bun.sh), Node 20+ (used by some build tools), Rust (stable), CMake.

```bash
bun install
bun run kafka:up      # optional: Kafka on localhost:9092 with demo data
bun run tauri dev     # first build compiles librdkafka; takes a few minutes
```

Then add a cluster with bootstrap `localhost:9092`.

### Tests

```bash
bun run lint          # cargo fmt --check + clippy (warnings are errors)
bun run test          # unit tests
bun run test:e2e      # everything, in Docker: build, Rust integration tests, UI end-to-end tests
```

### Building installers locally

Installers can only be built for the OS you're on:

```bash
bun run package:mac   # → src-tauri/target/release/bundle/{macos/KUI.app,dmg/*.dmg}
bun run package:win   # → src-tauri/target/release/bundle/{nsis/*-setup.exe,msi/*.msi}
```

On Windows you also need the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
("Desktop development with C++"), CMake, and a prebuilt OpenSSL so it isn't compiled from source (no Perl
needed). Install the full **Win64 OpenSSL v3** (not "Light") from
[slproweb.com](https://slproweb.com/products/Win32OpenSSL.html) and point the build at its static libraries:

```powershell
$o = "C:\Program Files\OpenSSL"
$env:OPENSSL_LIB_DIR = "$o\lib\VC\x64\MD"; $env:OPENSSL_INCLUDE_DIR = "$o\include"; $env:OPENSSL_ROOT_DIR = $o
$env:OPENSSL_LIBS = "libssl_static:libcrypto_static"; $env:OPENSSL_STATIC = "1"
```

[vcpkg](https://vcpkg.io) works too: `vcpkg install openssl:x64-windows-static-md-release`, then set
`OPENSSL_DIR` and `OPENSSL_ROOT_DIR` to its `installed\x64-windows-static-md-release` folder and `OPENSSL_STATIC=1`.

## Workflow

KUI uses **trunk-based development**: `main` is always releasable, and every change reaches it through a
short-lived branch and a pull request. There are no long-lived `develop` or feature branches.

```text
main ──●───────────────●──────────────●──►     (squash merges only; releases are tagged here)
        \             /                \
         feat/live-filter                fix/empty-topic-crash
```

1. Branch from an up-to-date `main`: `git switch main && git pull && git switch -c feat/live-filter`.
2. Commit as often as you like, using the message format below. Keep the branch up to date with
   `git pull --rebase origin main`.
3. Open a pull request with a Conventional Commit title. CI must pass: lint, tests and audits on Linux, plus a
   build on macOS and Windows.
4. PRs are **squash-merged**, so the **PR title** becomes the one commit on `main`. Delete the branch afterwards.

## Branch names

```text
<type>/<short-description>      feat/live-filter, fix/empty-topic-crash, docs/release-guide
```

Use the same types as commits (below), and lowercase letters, digits, `.`, `_` and `-` in the description.

Committing directly on `main` is blocked locally (merge commits from `git pull` are fine), and branch protection
blocks it on GitHub.

## Commit and PR title format

KUI uses [Conventional Commits](https://www.conventionalcommits.org). The type decides the next version
(see [Releasing](#releasing)) and PR titles become the release notes, so the type matters:

```text
<type>(<optional scope>)<optional !>: <summary in the imperative>
```

| Type | Use for | Version bump |
| --- | --- | --- |
| `feat` | a user-visible feature | minor |
| `fix` | a user-visible bug fix | patch |
| `perf` | a performance improvement | patch |
| `revert` | reverting an earlier commit | patch |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | everything users don't see | none |

Use a scope for security fixes and app dependency updates, so they count as a patch: `fix(security): …`,
`fix(deps): bump rdkafka to 0.40`. Use `chore(deps):` for dev-only tooling.

Add `!` after the type (`feat!:`), or a `BREAKING CHANGE:` footer, for changes that break existing users, such as
saved clusters that no longer load.

Examples:

```text
feat(messages): add live mode filter
fix(consumer-groups): show lag for empty partitions
refactor: split kafka client into admin and consumer modules
```

Also:

- Start the summary in lowercase, use the imperative ("add", not "added"), and don't end it with a period.
- Keep the first line to 72 characters. Explain *why* in the body, after a blank line.
- Footers such as `BREAKING CHANGE: …`, `Refs: #42` go at the end.

## Git hooks

`bun install` installs the hooks ([lefthook.yml](lefthook.yml), scripts in
[scripts/git-hooks](scripts/git-hooks)):

| Hook | Checks |
| --- | --- |
| `pre-commit` | branch name and not on `main`, rustfmt, TypeScript types |
| `commit-msg` | commit message format (and the branch name again, for empty commits) |
| `pre-push` | clippy, Rust tests, UI tests |

Skip them once with `git commit --no-verify`, or `LEFTHOOK=0`. CI checks the PR title anyway, so on a PR branch
only the title has to be perfect. Squash merging replaces the individual commits.

## Releasing

Releases are manual: nothing ships until you push a version tag.
[release.yml](.github/workflows/release.yml) then builds the macOS `.dmg` and the Windows `.exe`/`.msi`, and attaches
them to a **draft** release with notes generated from the merged PRs.

1. Pick the version from the commit types since the last release (table above; before 1.0, breaking changes bump
   the minor). Use plain `X.Y.Z`: the Windows MSI format rejects suffixes like `-beta.1`.
2. Bump it in a PR, e.g. `chore: release 0.2.0`:

   ```bash
   scripts/set-version.sh 0.2.0   # package.json, Cargo.toml and Cargo.lock
   ```

3. After it's merged, tag the merge commit on `main`:

   ```bash
   git switch main && git pull
   git tag v0.2.0 && git push origin v0.2.0
   ```

   The workflow refuses tags that don't match the version in the files or aren't on `main`.
4. When the build finishes (about 20–30 minutes), install from the draft, smoke-test it against
   `bun run kafka:up`, and click **Publish release**. `0.x` releases are marked as pre-releases (beta).

**Actions → Release → Run workflow** builds the installers as workflow artifacts from any branch, without releasing.

Code signing is optional. Add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (plus
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for notarization) or `WINDOWS_CERTIFICATE`,
`WINDOWS_CERTIFICATE_PASSWORD` as repository secrets and the workflow signs automatically. On a public repo each
installer also gets signed build provenance: `gh attestation verify <file> --repo tructn/kui`.
