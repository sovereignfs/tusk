#!/usr/bin/env bash
# Decide which CI jobs a change needs.
#
#   git diff --name-only BASE HEAD | scripts/ci-changes.sh
#
# Reads changed paths on stdin and prints `name=true|false` lines, ready to be appended to $GITHUB_OUTPUT:
#
#   code     the app can be affected: format, lint, type-check, build and test
#   scripts  the shell scripts can be affected (shellcheck, and the classifier's own tests)
#
# A change to documentation alone sets neither, so the jobs do not run for it. The rules err towards running: anything that is not named as a
# document below counts as code, so a new kind of file that the build or a test reads is covered without being added here.
#
# Not here on purpose: the publish workflow only runs on a tag.
#
# Written for bash 3.2.

set -euo pipefail

code=false
scripts=false

# Documents nothing builds or tests from. A regex and not a glob, because in a `case` pattern `*` matches `/`. The README is one until a test
# reads it (task 11.2 checks that every setting is in it), and then it stops being one.
document='^(README|CHANGELOG|CONTRIBUTING|AGENTS|CLAUDE|DESIGN|ROADMAP|SECURITY|RELEASING)\.md$|^LICENSE$|^docs/|^\.github/(PULL_REQUEST_TEMPLATE\.md|dependabot\.yml)$'

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if [[ $path =~ $document ]]; then
    continue
  fi
  case "$path" in
    # Changing the classifier changes what runs, so run everything.
    scripts/ci-changes.sh | scripts/test-ci-changes.sh)
      code=true
      scripts=true
      ;;
    # The release scripts have their own checks, and nothing in the app reads them.
    scripts/release.sh | scripts/lib/* | scripts/release/* | scripts/test-release.sh) scripts=true ;;
    *) code=true ;;
  esac
done

printf 'code=%s\n' "$code"
printf 'scripts=%s\n' "$scripts"
