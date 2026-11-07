#!/usr/bin/env bash
# Tests for scripts/ci-changes.sh. Fast and dependency-free, so CI runs them.
#
# The cases that matter are the ones where a wrong answer is costly in one direction or the other: a document must not start the build, and
# a file that the build or the tests read must.

set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PASSED=0
FAILED=0

# expect "name" "code=… scripts=…" path...
expect() {
  local name=$1 want=$2 got
  shift 2
  got=$(printf '%s\n' "$@" | "$HERE/ci-changes.sh" | tr '\n' ' ' | sed 's/ $//')
  if [ "$got" = "$want" ]; then
    PASSED=$((PASSED + 1))
    printf '  pass  %s\n' "$name"
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s\n          wanted: %s\n          got:    %s\n' "$name" "$want" "$got"
  fi
}

NONE="code=false scripts=false"
CODE="code=true scripts=false"
SCRIPTS="code=false scripts=true"
ALL="code=true scripts=true"

printf '\nchanges that need nothing\n'
expect "no changes at all" "$NONE"
expect "the root documents" "$NONE" README.md CHANGELOG.md CONTRIBUTING.md AGENTS.md CLAUDE.md DESIGN.md ROADMAP.md
expect "the documentation folder" "$NONE" docs/epics/foundation.md docs/README.md docs/rfcs/0001-sharing.md
expect "the licence" "$NONE" LICENSE
expect "the PR template and Dependabot's file" "$NONE" .github/PULL_REQUEST_TEMPLATE.md .github/dependabot.yml
expect "several documents together" "$NONE" ROADMAP.md CHANGELOG.md docs/epics/sync.md

printf '\nchanges that need the app jobs\n'
expect "a page" "$CODE" app/page.tsx
expect "a source file" "$CODE" src/position.ts
expect "a test" "$CODE" src/position.test.ts
expect "the lockfile" "$CODE" pnpm-lock.yaml
expect "package.json" "$CODE" package.json
expect "a migration" "$CODE" migrations/sqlite/0000_init.sql
expect "the manifest an instance reads" "$CODE" sovereign.manifest.json
expect "the image" "$CODE" Dockerfile .dockerignore
expect "the workflow itself" "$CODE" .github/workflows/ci.yml
expect "the publish workflow" "$CODE" .github/workflows/publish.yml
expect "a Markdown file that is not one of the documents" "$CODE" src/landing/terms.md
expect "a document in a subfolder of the root that is not under docs" "$CODE" deploy/README.md
expect "a document and a source file together" "$CODE" README.md src/time.ts
expect "an unknown kind of file" "$CODE" something/new.thing

printf '\nchanges that need only the script checks\n'
expect "a release script" "$SCRIPTS" scripts/release.sh
expect "the release library" "$SCRIPTS" scripts/lib/release.sh
expect "a release file" "$SCRIPTS" scripts/release/tusk.sh
expect "the release tests" "$SCRIPTS" scripts/test-release.sh
expect "other scripts are the app's" "$CODE" scripts/deploy-check.sh

printf '\nthe classifier itself\n'
expect "changing the classifier runs everything" "$ALL" scripts/ci-changes.sh
expect "changing its tests runs everything" "$ALL" scripts/test-ci-changes.sh

printf '\nboth kinds at once\n'
expect "a source file and a release script" "$ALL" src/time.ts scripts/release.sh
expect "a document and a release script" "$SCRIPTS" ROADMAP.md scripts/release.sh

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
