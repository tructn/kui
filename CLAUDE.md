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

## Standards

Follow @docs/CODE_STANDARDS.md for architecture, language rules, security and comments. Workflow, commit format
and releasing are in @CONTRIBUTING.md.
