#!/bin/bash
# Re-vendors the courses.mooc.fi exercise-services client OpenAPI document into
# this repo.
#
# The spec is generated in secret-project-331 from the utoipa annotations on
# the exercise-services client controller
# (services/headless-lms/server/src/controllers/exercise_services/client.rs)
# via the existing `export-openapi` pipeline, and committed there as
# services/headless-lms/server/openapi/exercise-services-client.openapi.generated.json.
#
# The vendored copy at backend/mooc/exercise-services-client.openapi.generated.json is the single
# source of truth the mooc mock backend routes and validates against: the mock
# cannot silently drift from the real API because every request AND response is
# validated against this document at runtime (see backend/mooc/router.ts).
#
# For now this copies from a local secret-project-331 checkout, because the
# extension currently tracks the unreleased `programming-exercise-migration`
# work.
#
# Drift gating (two layers):
#   * Byte-compare against the sibling checkout (`--check`) is LOCAL-ONLY: CI has
#     no secret-project-331 checkout, so it cannot run it. Run it before
#     committing a spec-touching change to confirm the vendored copy is
#     byte-identical to the sibling.
#   * A provenance STAMP committed next to the vendored spec
#     (exercise-services-client.openapi.source.json: the source rev + the spec's
#     sha256) lets CI verify the vendored spec has not been hand-edited without a
#     re-vendor. `--check-stamp` performs that check and needs NO sibling
#     checkout, so it is the gate CI runs (see .github/workflows/test.yml).
#
# Run via `pnpm run vendor:langs-openapi` (copy + refresh stamp),
# `pnpm run vendor:langs-openapi -- --check` (byte-compare vs sibling + stamp),
# or `pnpm run vendor:langs-openapi -- --check-stamp` (stamp only, no sibling).
set -euo pipefail

cd "$(dirname "$0")/.."

SP331_CHECKOUT="${SECRET_PROJECT_331_CHECKOUT:-../secret-project-331}"
SOURCE="$SP331_CHECKOUT/services/headless-lms/server/openapi/exercise-services-client.openapi.generated.json"
TARGET="./backend/mooc/exercise-services-client.openapi.generated.json"
STAMP="./backend/mooc/exercise-services-client.openapi.source.json"

# sha256 of a file, portable across Linux (sha256sum) and macOS (shasum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Reads the "sha256" value out of the stamp file (no jq dependency).
stamp_sha256() {
  node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$STAMP','utf8')).sha256||''))"
}

# `pnpm run <script> -- <arg>` can forward the literal "--" separator as $1; drop it.
if [ "${1:-}" = "--" ]; then
  shift
fi
MODE="${1:-}"

# --check-stamp: verify the vendored spec still matches the committed provenance
# stamp. Needs NO secret-project-331 checkout, so this is the gate CI runs. It
# catches a hand-edit of the vendored spec that never went through re-vendoring.
if [ "$MODE" = "--check-stamp" ]; then
  if [ ! -f "$STAMP" ]; then
    echo "error: $STAMP not found. Run 'pnpm run vendor:langs-openapi' to create it." >&2
    exit 1
  fi
  if [ ! -f "$TARGET" ]; then
    echo "error: $TARGET not found." >&2
    exit 1
  fi
  actual="$(sha256_of "$TARGET")"
  expected="$(stamp_sha256)"
  if [ "$actual" = "$expected" ]; then
    echo "OK: vendored spec sha256 matches the stamp ($expected)"
    exit 0
  fi
  echo "STAMP MISMATCH: $TARGET sha256 $actual != stamp $expected" >&2
  echo "The vendored spec was hand-edited or the stamp is stale." >&2
  echo "Re-vendor from secret-project-331 with 'pnpm run vendor:langs-openapi'." >&2
  exit 1
fi

# The remaining modes read the sibling secret-project-331 checkout.
if [ ! -f "$SOURCE" ]; then
  echo "error: $SOURCE not found." >&2
  echo "Set SECRET_PROJECT_331_CHECKOUT to your secret-project-331 checkout." >&2
  exit 1
fi

# sanity check: must be valid JSON
node -e "JSON.parse(require('fs').readFileSync('$SOURCE', 'utf8'))"

if [ "$MODE" = "--check" ]; then
  status=0
  if diff -q "$SOURCE" "$TARGET" >/dev/null 2>&1; then
    echo "OK: vendored langs OpenAPI is byte-identical to $SOURCE"
  else
    echo "DRIFT: $TARGET differs from $SOURCE" >&2
    echo "Run 'pnpm run vendor:langs-openapi' to re-vendor." >&2
    diff "$SOURCE" "$TARGET" >&2 || true
    status=1
  fi
  # Also validate the provenance stamp (the standalone check CI runs).
  if [ -f "$STAMP" ]; then
    actual="$(sha256_of "$TARGET")"
    expected="$(stamp_sha256)"
    if [ "$actual" = "$expected" ]; then
      echo "OK: vendored spec sha256 matches the stamp ($expected)"
    else
      echo "STAMP MISMATCH: $TARGET sha256 $actual != stamp $expected" >&2
      status=1
    fi
  else
    echo "error: $STAMP not found; run 'pnpm run vendor:langs-openapi' to create it." >&2
    status=1
  fi
  exit $status
fi

# default: (re-)vendor.
# copy byte-for-byte so the file can be diffed against the sibling directly
cp "$SOURCE" "$TARGET"

REV="$(git -C "$SP331_CHECKOUT" rev-parse HEAD 2>/dev/null || echo "unknown")"
SHA="$(sha256_of "$TARGET")"

# Write the provenance stamp next to the vendored spec. The sha256 is of the
# vendored spec itself (TARGET), so re-formatting this stamp does not affect it.
cat > "$STAMP" <<EOF
{
  "//": "Provenance stamp for the vendored exercise-services client OpenAPI spec. Written by bin/updateLangsOpenapi.sh; do not hand-edit. CI asserts the vendored spec's sha256 matches the value below via 'bin/updateLangsOpenapi.sh --check-stamp', catching a hand-edit that never went through re-vendoring.",
  "source_repo": "secret-project-331",
  "source_rev": "$REV",
  "sha256": "$SHA"
}
EOF

# Normalise the stamp to the repo's formatting so format:check stays green.
pnpm exec oxfmt "$STAMP" >/dev/null 2>&1 || true

echo "Vendored $SOURCE (secret-project-331 rev $REV) -> $TARGET"
echo "Wrote provenance stamp $STAMP (sha256 $SHA)"
echo "The mooc mock backend (backend/mooc/) validates against this document."
