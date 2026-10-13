#!/usr/bin/env bash
# Enforces the trunk-based branch flow in CONTRIBUTING.md: work happens on
# short-lived `<type>/<short-description>` branches that are merged into main
# through a pull request, so commits aren't made on main directly.
# Run by lefthook's pre-commit hook, and again by commit-msg because lefthook
# skips pre-commit jobs for empty commits. Skip once with `git commit --no-verify`.
set -euo pipefail

# Keep in sync with commit-msg.sh.
TYPES='feat|fix|perf|revert|docs|style|refactor|test|build|ci|chore'

branch=$(git symbolic-ref --quiet --short HEAD) || exit 0 # detached HEAD (rebase, bisect)

# Merge commits from `git pull` / `git merge` are how main is kept up to date.
git rev-parse --quiet --verify MERGE_HEAD >/dev/null && exit 0

case "$branch" in
  main | master)
    {
      echo "✖ Don't commit directly to $branch. Changes reach $branch through pull requests."
      echo "  Move your work to a branch (your staged changes come along):"
      echo
      echo "    git switch -c feat/<short-description>"
    } >&2
    exit 1
    ;;
  release-please--*) exit 0 ;;          # created by release-please
esac

if ! printf '%s' "$branch" | grep -Eq "^($TYPES)/[a-z0-9][a-z0-9._-]*$"; then
  {
    echo "✖ Branch '$branch' doesn't follow the naming convention (see CONTRIBUTING.md):"
    echo
    echo "    <type>/<short-description>   e.g. feat/live-filter, fix/empty-topic-crash"
    echo
    echo "  type is one of: ${TYPES//|/, }. Use lowercase, digits and '-' in the description."
    echo "  Rename it with: git branch -m <new-name>"
  } >&2
  exit 1
fi
