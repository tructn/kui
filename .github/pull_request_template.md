<!--
The PR title becomes the commit on main and the changelog entry, so use a Conventional Commit:
  feat(messages): add live mode filter
  fix(consumer-groups): show lag for empty partitions
See CONTRIBUTING.md#commit-and-pr-title-format.
-->

## What and why

<!-- What does this change, and why? Link issues with "Fixes #123". -->

## How I tested it

<!-- e.g. bun run test, bun run test:e2e, manually against a local cluster (bun run kafka:up). Screenshots for UI changes. -->

## Checklist

- [ ] The PR title follows [Conventional Commits](https://github.com/tructn/kui/blob/main/CONTRIBUTING.md#commit-and-pr-title-format), with `!` for breaking changes
- [ ] `bun run lint` and `bun run test` pass
- [ ] Docs (README, CONTRIBUTING) are updated if behavior or setup changed
