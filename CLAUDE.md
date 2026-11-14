# KUI

Desktop Kafka UI: Tauri 2 (Rust, rdkafka) backend with a React 19 + TypeScript frontend built by Vite.

- `crates/kui_kafka` Kafka client layer, `crates/kui_tql` message query language, `crates/kui_desktop` Tauri app
- `frontend/` UI, `e2e/` WebdriverIO suite (runs in Docker)
- The Cargo workspace root is the repo root. Run `cargo` and `bun` from there.

## Commands

```bash
bun run tauri dev      # first build compiles librdkafka, takes minutes
bun run kafka:up       # local Kafka on :9092 with demo data
bun run lint           # cargo fmt --check + clippy -D warnings
bun run test           # bun test frontend && cargo test
bunx tsc --noEmit      # frontend typecheck (not part of `bun run test`)
bun run test:e2e       # Docker only
```

Run lint, tests and `tsc --noEmit` for the side you changed before calling work done.

## Architecture

- Backend features live in `crates/kui_desktop/src/features/<name>/`: `commands.rs` (thin `#[tauri::command]`),
  `service.rs` (logic, no Tauri types), `model.rs` (serde types crossing IPC).
- New commands must be added to `generate_handler!` in `crates/kui_desktop/src/lib.rs`.
- Blocking librdkafka calls go through `run_blocking`; never block the async runtime.
- Errors use the single `Error` in `error.rs`; it serializes to a plain string for the UI.
- Frontend features live in `frontend/features/<name>/`: `api.ts` -> `queries.ts` (TanStack Query) -> `components/`.
- The UI reaches Rust only through `callCommand` in `frontend/lib/invoke.ts`. It also records commands for the
  "no unprompted changes" e2e spec, so don't call `invoke` directly.
- `frontend/features/*/types.ts` hand-mirrors the Rust models. Change both in the same commit.
- `frontend/components/ui` is shadcn output. Add components with the shadcn CLI, don't hand-edit them.

## Code conventions

- `unsafe` is denied, and `dbg!`, `todo!`, `println!` warn (clippy runs with `-D warnings`). No `unwrap`/`expect`
  outside tests.
- Operations that change a cluster (delete, reset offsets, produce) must be explicit user actions, and browsing
  must never send one.
- Never log or serialize cluster credentials. They go through `clusters/secrets.rs`. That includes `assert!`/`panic!`
  messages in tests (CodeQL flags them): name the field that leaked, never print its value or a `Debug` dump.
- `SECRET_PROPERTIES` in `kui_kafka/src/cluster.rs` is the single list of secret property keys. Leak tests iterate
  it, so add new keys there rather than to a test.
- Put pure frontend logic in `frontend/lib/` with a sibling `*.test.ts` (`bun:test`). Test files are excluded from
  `tsc`.
- Use the `@/` import alias and Tailwind utilities with `cn()`.
- Share Rust dependency versions via `[workspace.dependencies]`. CI audits dependencies, so avoid adding new ones.
- `glib 0.18` (RUSTSEC-2024-0429, Dependabot) can't be upgraded: Tauri's Linux backend pins GTK3 / gtk-rs 0.18, the
  fix is only in the GTK4-era 0.20, and glib isn't built for the macOS/Windows releases. Don't try to bump it.
- Comments: only the non-obvious why (a constraint, gotcha or workaround), the kind a human maintainer would leave
  for the next person. If good naming already says it, don't comment. Don't restate the code, narrate steps, label
  sections, explain a change ("now uses X", "fixed Y"), or leave commented-out code.
