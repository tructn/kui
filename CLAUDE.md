# KUI

Desktop Kafka UI: Tauri 2 (Rust, rdkafka) backend with a React 19 + TypeScript frontend built by Vite.

- `crates/kui_kafka` Kafka client layer, `crates/kui_mql` message query language, `crates/kui_desktop` Tauri app
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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. Full exploration rules: `docs/GRAPHIFY.md`.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
