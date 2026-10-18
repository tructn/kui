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
bun run package:win   # → src-tauri/target/release/bundle/nsis/*-setup.exe
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

Releases are made by [release-please](https://github.com/googleapis/release-please) in
[.github/workflows/release.yml](.github/workflows/release.yml), from the Conventional Commit titles on `main`.

1. Merging a `feat`, `fix`, `perf` or `revert` PR (or a breaking change) opens or updates a **release PR**,
   `chore(main): release X`. It bumps the version in package.json, Cargo.toml and Cargo.lock and adds the
   version's [CHANGELOG.md](CHANGELOG.md) entry, grouped as in the table above. Other types don't release.
   Don't edit the changelog by hand: entries come from PR titles, so get the title right before merging.
2. Merge the release PR when you're ready to ship. release-please tags the merge commit `vX.Y.Z` and creates a
   draft release. The workflow then builds the macOS `.dmg` and Windows `.exe`, attaches them, and publishes
   the release with that version's changelog entry as its notes.
   If a build fails, the release stays a draft, which users and the updater don't see: **Re-run failed jobs**
   for a flaky failure. For one that needs a code fix, delete the draft (keep the tag, release-please counts
   from it) and merge the fix: the next release PR ships it as the next version.
3. Versions with a pre-release suffix (`v0.2.0-beta.1`) are published as GitHub pre-releases; plain `vX.Y.Z`
   ones as normal releases.
   Installed apps find the release through the in-app updater (below); pre-releases only reach users who turned on
   **Settings → Updates → Include release candidates**.

Versioning is set in [release-please-config.json](release-please-config.json), and the last released version
in [.release-please-manifest.json](.release-please-manifest.json). KUI is in alpha, so each release bumps the
`-alpha.N` number. To change channel, add a `Release-As: 0.2.0-beta.1` footer to a commit (the next release PR
uses that version) and set `prerelease-type` to `beta`; for stable releases, remove `versioning`, `prerelease`
and `prerelease-type`. Before 1.0, breaking changes bump the minor.

The release PR is opened with the workflow's `GITHUB_TOKEN`, which needs **Settings → Actions → General → Allow
GitHub Actions to create and approve pull requests**. CI doesn't run on PRs it opens; to get checks on it, add a
`RELEASE_PLEASE_TOKEN` secret: a fine-grained personal access token for this repo with **Contents** and
**Pull requests** read and write.

To build the installers without releasing, run the workflow by hand (**Actions → Release → Run workflow**); they
are attached to the run as artifacts.

### In-app updates

Each release carries `latest.json`, the manifest KUI's updater reads ([src-tauri/src/updates.rs](src-tauri/src/updates.rs)),
and update packages signed with the **updater key**. This key is separate from code signing and is required: a tag
build fails without it. The public key is `plugins.updater.pubkey` in [tauri.conf.json](src-tauri/tauri.conf.json); the
private key goes in the `TAURI_SIGNING_PRIVATE_KEY` secret (and its password, if it has one, in
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`):

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/kui-updater.key
```

Keep a backup of the private key. Installed apps only accept updates signed with it: if it's lost, generate a new
pair (`bunx tauri signer generate -w ~/.tauri/kui-updater.key`), and users must reinstall by hand once to get an
app that trusts the new public key.

Code signing is optional. Add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (plus
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for notarization) or `WINDOWS_CERTIFICATE`,
`WINDOWS_CERTIFICATE_PASSWORD` as repository secrets and the workflow signs automatically. Without them, macOS
Gatekeeper blocks the first launch ("Apple could not verify…"), and Windows SmartScreen and antivirus scanners
warn about the installer; README.md tells users how to get past both. Getting rid of the warnings takes:

- **macOS:** an Apple Developer Program membership, a *Developer ID Application* certificate exported as a
  base64 `.p12` (`APPLE_CERTIFICATE`), and an app-specific password for notarization (`APPLE_PASSWORD`). A signed
  but un-notarized app is still blocked, so set all six secrets.
- **Windows:** a code-signing certificate. CAs no longer issue new OV/EV certificates as exportable `.pfx`
  files (the keys must stay on a hardware token or a cloud HSM), so the `WINDOWS_CERTIFICATE` route only works
  with an older certificate. New setups need a cloud signer such as Azure Trusted Signing or SignPath (free for
  open-source projects), hooked in through Tauri's `bundle.windows.signCommand`. SmartScreen reputation builds
  up as signed downloads accumulate.

On a public repo each installer also gets signed build provenance: `gh attestation verify <file> --repo tructn/kui`.
