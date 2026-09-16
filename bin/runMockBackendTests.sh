#!/bin/bash
# Runs the mooc mock backend's node:test suites and fails unless at least
# MINIMUM_PASSING of them passed.
#
# Both ways this suite can disappear exit 0 on their own: `pnpm --filter <name>
# run test` when the filter matches no package, and `node --test` when its glob
# matches no files. The floor is the only thing that turns either into a
# failure, so raise it whenever the suite grows.
#
# bin/verifyGatesCanFail.sh breaks both of those inputs and asserts this script
# still fails.
set -euo pipefail

MINIMUM_PASSING=148

cd "$(dirname "$0")/../backend"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# pipefail is what keeps a real test failure propagating through the tee instead
# of being overwritten by the exit status of the command reading the log.
pnpm test 2>&1 | tee "$log"

passing="$(sed -nE 's/^[^0-9]*pass ([0-9]+)$/\1/p' "$log" | tail -n 1)"
if [ "${passing:-0}" -lt "$MINIMUM_PASSING" ]; then
  echo "Mock backend suite passed ${passing:-0} tests, expected at least $MINIMUM_PASSING." >&2
  echo "Either the suite shrank or it never ran; raise MINIMUM_PASSING in bin/runMockBackendTests.sh when it grows." >&2
  exit 1
fi
