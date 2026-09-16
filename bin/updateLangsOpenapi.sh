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
# Drift gating (three layers):
#   * Byte-compare against the sibling checkout (`--check`) needs that checkout,
#     so it is for local use before committing a spec-touching change.
#   * A provenance STAMP committed next to the vendored spec
#     (exercise-services-client.openapi.source.json: the source rev + the spec's
#     sha256) lets CI verify the vendored spec has not been hand-edited without a
#     re-vendor. `--check-stamp` performs that check and needs NO sibling
#     checkout, so it is the gate CI runs (see .github/workflows/test.yml).
#   * `--check-source` fetches the spec from GitHub at the stamp's source_rev and
#     byte-compares, which is the only layer that catches a stamp refreshed from
#     a dirty or unpushed sibling checkout. It needs network, and the recorded
#     rev currently lives on sp331's programming-exercise-migration branch, so
#     it stays non-blocking in CI until PR #1769 merges.
#
# Run via `pnpm run vendor:langs-openapi` (copy + refresh stamp), or with
# `-- --check`, `-- --check-stamp` or `-- --check-source`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/stamp.sh"

cd "$SCRIPT_DIR/.."

SP331_CHECKOUT="${SECRET_PROJECT_331_CHECKOUT:-../secret-project-331}"
SPEC_PATH="services/headless-lms/server/openapi/exercise-services-client.openapi.generated.json"
SOURCE="$SP331_CHECKOUT/$SPEC_PATH"
TARGET="./backend/mooc/exercise-services-client.openapi.generated.json"
STAMP="./backend/mooc/exercise-services-client.openapi.source.json"
SOURCE_URL="https://raw.githubusercontent.com/rage/secret-project-331/{rev}/$SPEC_PATH"
REVENDOR="pnpm run vendor:langs-openapi"

MODE="$(vendor_mode "$@")"

# --check-stamp: verify the vendored spec still matches the committed provenance
# stamp. Needs NO secret-project-331 checkout, so this is the gate CI runs. It
# catches a hand-edit of the vendored spec that never went through re-vendoring.
if [ "$MODE" = "--check-stamp" ]; then
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR"
  exit $?
fi

# --check-source: fetch the spec at the stamp's recorded rev and byte-compare.
# Needs no checkout either, but does need network and a rev that is reachable on
# a pushed branch.
if [ "$MODE" = "--check-source" ]; then
  rev="$(stamp_field "$STAMP" source_rev)"
  url="$(stamp_field "$STAMP" source_url)"
  if [ -z "$rev" ] || [ -z "$url" ]; then
    echo "error: $STAMP records no source_rev/source_url; re-vendor with '$REVENDOR'." >&2
    exit 1
  fi
  url="${url//\{rev\}/$rev}"
  fetched="$(mktemp)"
  trap 'rm -f "$fetched"' EXIT
  if ! curl -fsSL "$url" -o "$fetched"; then
    echo "error: could not fetch $url" >&2
    echo "The recorded rev may not be pushed, or may live on a branch that was force-updated." >&2
    exit 1
  fi
  if diff -q "$fetched" "$TARGET" >/dev/null 2>&1; then
    echo "OK: vendored spec is byte-identical to $url"
    exit 0
  fi
  echo "DRIFT: $TARGET differs from the spec at the recorded rev" >&2
  echo "$url" >&2
  diff "$fetched" "$TARGET" >&2 || true
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
    echo "Run '$REVENDOR' to re-vendor." >&2
    diff "$SOURCE" "$TARGET" >&2 || true
    status=1
  fi
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR" || status=1
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
  "source_url": "$SOURCE_URL",
  "sha256": "$SHA"
}
EOF

# Normalise the stamp to the repo's formatting so format:check stays green.
pnpm exec oxfmt "$STAMP" >/dev/null 2>&1 || true

echo "Vendored $SOURCE (secret-project-331 rev $REV) -> $TARGET"
echo "Wrote provenance stamp $STAMP (sha256 $SHA)"
echo "The mooc mock backend (backend/mooc/) validates against this document."
