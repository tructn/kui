# Graphify — Codebase Exploration Rules

This project uses [Graphify](https://github.com/graphify) to maintain a local knowledge graph in `graphify-out/`, containing god nodes, community structure, symbol relationships, and cross-file dependencies.

The knowledge graph is generated locally and is intentionally excluded from Git.

## 1. Graph-first exploration (mandatory)

Before investigating any codebase question:

1. Check whether `graphify-out/graph.json` exists.
2. If it does not exist, run `graphify update .` to generate the knowledge graph.
3. If it exists but appears stale or inconsistent with the current source code, run `graphify update .` to refresh it.
4. Run `graphify query "<question>"` before your first grep, search, or source-file read.
5. Use the graph results to identify relevant files, symbols, and relationships before inspecting source code.

Treat graph results as navigation hints, not guaranteed truth. Always verify important findings against the actual source code.

**Subagents:** Include these Graphify exploration rules in every subagent prompt that investigates or explores the codebase. Subagents should reuse the existing graph rather than independently performing broad repository searches.

## 2. Use focused graph commands

Choose the appropriate Graphify command for each investigation:

- `graphify query "<question>"` — Discover relevant nodes, files, symbols, and relationships for a question.
- `graphify path "<A>" "<B>"` — Investigate dependencies and relationships between two nodes.
- `graphify explain "<concept>"` — Understand a specific concept, component, or subsystem.
- `graphify section "<heading>"` — Retrieve the content of a specific Markdown heading without opening the entire document.

Use only the commands relevant to the investigation. Avoid unnecessary or repetitive graph queries.

## 3. Source-code inspection

- If `graphify-out/wiki/index.md` exists, use it for broad documentation navigation instead of browsing source files blindly.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture reviews or when focused graph queries do not provide sufficient context.
- Use graph results to identify relevant files and symbols before reading source code.
- Inspect the relevant implementation and sufficient surrounding context to understand and verify behavior.
- Follow imports, callers, dependencies, and related implementations when necessary.
- Avoid broad, unscoped file dumps and repository-wide grep searches unless graph exploration is insufficient.
- Never assume that graph relationships fully represent runtime behavior. Verify important conclusions against the implementation.

## 4. Keep the graph synchronized

Because `graphify-out/` is locally generated and Git-ignored, each development environment must maintain its own graph.

Run:

`graphify update .`

When:
- The graph does not exist.
- Source code has been modified.
- Source files have been added, removed, or renamed.
- Changes affect graph inputs or relationships.
- The graph appears stale or inconsistent with the current repository state.

Verify that the update succeeds before relying on the refreshed graph.

Do not rebuild the graph unnecessarily when no relevant source changes have occurred.

## 5. Git and generated artifacts

- `graphify-out/` is intentionally excluded through `.gitignore`.
- Do not commit generated Graphify artifacts.
- Do not remove the local graph merely because it is Git-ignored.
- Do not suggest disabling Graphify generation or update hooks to avoid generated-file diffs.
- Each developer, coding agent, and CI environment should generate its own graph when needed.
- A fresh clone should generate the graph before its first codebase investigation.

## 6. Core principle

**Graphify is the navigation layer; source code is the source of truth.**

Use the knowledge graph to discover where to look, understand how components connect, and reduce unnecessary repository exploration.

Use the actual source code to verify implementation details, behavior, and conclusions.

The goal is efficient, relationship-aware codebase exploration without sacrificing correctness.