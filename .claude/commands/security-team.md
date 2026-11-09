---
description: Run the KUI security engineering team (audit, validate, fix, test, final review)
allowed-tools: Agent, Read, Grep, Glob, Bash, Edit, Write
---

# KUI security engineering team

Create and coordinate an Agent Team named `security-engineering` from these existing agents:
`security-auditor`, `vulnerability-validator`, `security-developer`, `security-tester`,
`final-reviewer`.

Scope: $ARGUMENTS (default: the whole app).

## Teams

| Team | Agents | Job |
| --- | --- | --- |
| Red (attack) | `security-auditor`, `vulnerability-validator` | Find weaknesses, then prove or discard them by exploiting them. Never fix. |
| Blue (defence) | `security-developer` | Fix confirmed findings at the root cause, with regression tests and docs. |
| Purple (bridge) | `security-tester`, `final-reviewer` | Replay the red team's attacks against the blue team's fixes, feed gaps back to both sides, and referee the final verdict. |

Red and blue never approve their own work; purple does.

## Before starting

- Run `git status`. If there are uncommitted changes outside `security/` and `.claude/`, tell me and wait; do
  not build on top of unrelated work.
- Run `cargo` and `bun` from the repo root. The first Rust build compiles librdkafka and takes minutes.
- Anything needing a broker uses the local demo cluster only (`bun run kafka:up`). Never connect to a real cluster.
- Findings, validation, fix and test reports live in `security/findings/` (gitignored).

## Workflow

1. Map the architecture from `CLAUDE.md` and the code. Note which controls `crates/kui_desktop/src/security_tests.rs` and the e2e security specs already pin.
2. Red team: `security-auditor` audits the scope. Split independent areas (webview and message rendering,
   IPC and capabilities, credentials, Kafka write paths, TQL/codec parsing, updater and supply chain) across
   parallel auditors if the scope is large.
3. Red team: `vulnerability-validator` verifies every finding independently.
4. Prioritise `CONFIRMED` findings by severity. Show me the list before any code changes.
5. Blue team: `security-developer` fixes one finding at a time (test first, fix, docs). Coordinate so two
   agents never edit the same file.
6. Purple team: `security-tester` independently re-attacks and runs the suites. Failed or blocked results go
   back to the developer.
7. Red team: `security-auditor` re-audits the modified code for regressions.
8. Purple team: `final-reviewer` independently verifies everything.
9. Repeat 5 to 8 until the completion criteria hold.

## Rules

- Follow `CLAUDE.md`. Work on `main`; do not create branches.
- Never let an agent approve its own work.
- Never disable, skip or loosen a test or a posture expectation to get green.
- Do not widen the CSP or Tauri capabilities, add dependencies or weaken credential handling. If a fix seems to need that, stop and ask me.
- Never push or deploy. Do not commit unless I ask; when I do, use Conventional Commits and keep each fix's code, tests and docs in one commit.
- Ask before any destructive operation. Use generated fixtures and the local demo cluster only.
- Do not modify `CLAUDE.md` or `CHANGELOG.md`.

## Completion criteria

- No unresolved Critical or High findings.
- Every confirmed finding is fixed or recorded as an accepted risk with a reason.
- `bun run lint`, `cargo test`, `bun test frontend` and `bunx tsc --noEmit` pass.
- `final-reviewer` returns `SECURITY_APPROVED`.

Never claim the app is 100% secure. Report blockers and remaining risks honestly.
