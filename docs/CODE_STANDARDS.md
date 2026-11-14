# Code standards

## Architecture

- Backend features live in `crates/kui_desktop/src/features/<name>/`: `commands.rs` (thin `#[tauri::command]`),
  `service.rs` (logic, no Tauri types), `model.rs` (serde types crossing IPC).
- New commands must be added to `generate_handler!` in `crates/kui_desktop/src/lib.rs`.
- Errors use the single `Error` in `error.rs`; it serializes to a plain string for the UI.
- Frontend features live in `frontend/features/<name>/`: `api.ts` -> `queries.ts` (TanStack Query) -> `components/`.
- The UI reaches Rust only through `callCommand` in `frontend/lib/invoke.ts`. It also records commands for the
  "no unprompted changes" e2e spec, so don't call `invoke` directly.
- `frontend/features/*/types.ts` hand-mirrors the Rust models. Change both in the same commit.
- `frontend/components/ui` is shadcn output. Add components with the shadcn CLI, don't hand-edit them.

## Design

- **Single responsibility.** A command adapts IPC, a service holds the logic, a model is data. Keep pure logic
  (paging windows, codecs, reset plans, completion) in its own module so it is unit-tested without Kafka or a DOM.
- **Depend on abstractions at the edges.** Side effects sit behind small traits or functions (`SecretStore`,
  `Record`, `callCommand`) so tests swap in fakes. Don't add a trait with only one implementation and no test
  double.
- **Features don't depend on each other.** Shared code goes in `kui_kafka` (Rust) or `frontend/lib`,
  `frontend/hooks`, `frontend/components` (UI). A feature exposes only what its `index.ts` exports.
- **Open for extension.** New pages, commands, placeholders or query functions are added as data or a new variant,
  not by special-casing callers. Exhaustive `match` / `switch` makes the compiler find every place to update.
- Prefer plain functions and composition over class hierarchies and patterns for their own sake. Reach for a
  pattern (builder, strategy, adapter) only when it removes duplication that already exists.

## Rust

- `unsafe` is denied, and `dbg!`, `todo!`, `println!` warn (clippy runs with `-D warnings`). No `unwrap`/`expect`
  outside tests.
- Make invalid states unrepresentable: enums over string flags, `Option` over sentinel values, newtypes where two
  values of the same type are easy to swap.
- Borrow rather than clone in hot paths; take `&str`/`&[T]` and return owned data only when the caller needs it.
- Errors carry context the user can act on and never quote input that could be a secret.
- Share dependency versions via `[workspace.dependencies]`. CI audits dependencies, so avoid adding new ones.

## TypeScript

- `strict` mode; no `any`, no non-null `!` outside tests. Narrow `unknown` from IPC or JSON with type guards.
- Model variants as discriminated unions (`{ kind: "range" } | { kind: "messages" }`) and switch on `kind`.
- Put pure logic in `frontend/lib/` with a sibling `*.test.ts` (`bun:test`). Test files are excluded from `tsc`.
- Use the `@/` import alias and Tailwind utilities with `cn()`.

## React

- Server state lives in TanStack Query (`queries.ts`); client state in small Zustand stores read with selectors.
  Don't copy query data into `useState`.
- Derive values during render instead of syncing them with `useEffect`. Effects are for subscriptions and
  imperative APIs (CodeMirror, Tauri channels), and they clean up after themselves.
- Keep components small and presentational; move logic into hooks (`frontend/hooks`) or `lib/` functions.
- Every interactive element is reachable by keyboard and has an accessible name.

## Performance

- Blocking librdkafka calls go through `run_blocking`; never block the async runtime.
- Batch Kafka requests (watermarks, group offsets) instead of one round trip per partition or group.
- Bound everything sized by cluster data: page byte budgets, live-tail limits, rendered list caps, query
  evaluation budgets. A hostile topic must not exhaust memory or freeze the UI.
- On the UI, memoize only where measured or where a stable identity is required (sort columns, CodeMirror
  extensions). Virtualize or cap long lists, and debounce work driven by typing.

## Security

- Operations that change a cluster (delete, reset offsets, produce) must be explicit user actions, and browsing
  must never send one.
- Treat message keys, values and headers as untrusted: render them as text, never as HTML or URLs.
- Never log or serialize cluster credentials. They go through `clusters/secrets.rs`.
- Test `assert!`/`panic!` messages count as logging (CodeQL flags them): name the field that leaked, never print
  its value or a `Debug` dump.
- `SECRET_PROPERTIES` in `crates/kui_kafka/src/cluster.rs` is the single list of secret property keys. Leak tests
  iterate it, so add new keys there rather than to a test.
- Validate IPC input in Rust; the webview is not a trust boundary.

### Known advisories

- `glib 0.18` (RUSTSEC-2024-0429) can't be upgraded: Tauri's Linux backend pins GTK3 / gtk-rs 0.18, the fix is
  only in the GTK4-era 0.20, and glib isn't built for the macOS and Windows releases.

## Comments

Write only the comment a maintainer would leave for the next person: the non-obvious *why*, such as a constraint,
a gotcha or a workaround. If the names already say it, don't comment.

- Don't restate the code, narrate steps or label sections.
- Don't describe the change itself ("now uses X", "fixed Y"); that belongs in the commit message.
- Don't reference internal tickets or review rounds; say what the code guards against instead.
- Don't leave commented-out code.
- Doc comments on public items are fine when they add what the signature can't (units, invariants, side effects).
