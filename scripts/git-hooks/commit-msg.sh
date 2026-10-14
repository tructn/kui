#!/usr/bin/env bash
# Checks a commit message against the Conventional Commits rules in
# CONTRIBUTING.md (they become the release notes).
# Run by lefthook's commit-msg hook: scripts/git-hooks/commit-msg.sh <msg-file>
# Skip once with `git commit --no-verify`.
set -euo pipefail

# The standard Conventional Commit types, which the CI
# PR-title check also use by default. Keep in sync with CONTRIBUTING.md.
TYPES='feat|fix|perf|revert|docs|style|refactor|test|build|ci|chore'
MAX_HEADER=72

# Drop everything from the `git commit -v` scissors line, then comment lines
# and leading blank lines, the way git cleans the message up.
msg=$(sed -e '/^# -* >8 -*$/,$d' -e '/^#/d' "$1" | sed -e '/./,$!d')
header=$(printf '%s\n' "$msg" | head -n1)

# Messages git writes itself.
case "$header" in
  "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;;
esac

errors=()
[ -z "$header" ] && errors+=("The message is empty.")

if [ -n "$header" ]; then
  if ! printf '%s' "$header" | grep -Eq "^($TYPES)(\([a-z0-9._/-]+\))?!?: [^ ]"; then
    errors+=("The first line must be '<type>(<scope>)!: <summary>', with type one of: ${TYPES//|/, }.
       The scope is optional, lowercase (e.g. 'topics', 'consumer-groups'). '!' marks a breaking change.")
  else
    summary=${header#*: }
    first=${summary:0:1}
    if [[ "$first" =~ [A-Z] ]] && ! [[ "${summary%% *}" =~ ^[A-Z0-9_]+$ ]]; then
      errors+=("Start the summary in lowercase: '${header%%: *}: $(tr '[:upper:]' '[:lower:]' <<<"$first")${summary:1}'.")
    fi
    [[ "$summary" == *. ]] && errors+=("Don't end the summary with a period.")
  fi
  [ "${#header}" -gt "$MAX_HEADER" ] &&
    errors+=("Keep the first line to $MAX_HEADER characters or fewer (it is ${#header}). Put details in the body.")
fi

second=$(printf '%s\n' "$msg" | sed -n 2p)
[ -n "$second" ] && errors+=("Leave a blank line between the first line and the body.")

if [ ${#errors[@]} -gt 0 ]; then
  {
    echo "✖ Commit message doesn't follow the convention (see CONTRIBUTING.md):"
    echo
    echo "    $header"
    echo
    for e in "${errors[@]}"; do echo "  - $e"; done
    echo
    echo "  Examples:  feat(messages): add live mode filter"
    echo "             fix: show lag for empty partitions"
    echo "             feat!: store passwords in the OS keychain"
    echo
    echo "  Your message was kept in .git/COMMIT_EDITMSG. Retry with: git commit -e -F .git/COMMIT_EDITMSG"
  } >&2
  exit 1
fi
