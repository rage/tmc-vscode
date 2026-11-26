#!/bin/bash
# Runs the mock backend's node:test suites and fails unless at least
# MINIMUM_PASSING of them passed.
#
# `pnpm --filter <name> run test` (no matching package) and `node --test` (no
# matching files) both exit 0, so the floor is the only failure signal; raise it
# when the suite grows. bin/verifyGatesCanFail.sh asserts this script still fails.
set -euo pipefail

MINIMUM_PASSING=315

cd "$(dirname "$0")/../backend"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# pipefail keeps a test failure from being masked by tee's exit status.
pnpm test 2>&1 | tee "$log"

passing="$(sed -nE 's/^[^0-9]*pass ([0-9]+)$/\1/p' "$log" | tail -n 1)"
if [ "${passing:-0}" -lt "$MINIMUM_PASSING" ]; then
  echo "Mock backend suite passed ${passing:-0} tests, expected at least $MINIMUM_PASSING." >&2
  echo "Either the suite shrank or it never ran; raise MINIMUM_PASSING in bin/runMockBackendTests.sh when it grows." >&2
  exit 1
fi
