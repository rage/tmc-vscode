#!/bin/bash
# Re-vendors the courses.mooc.fi exercise-services client OpenAPI document
# (generated in secret-project-331, see SPEC_PATH) into backend/mooc/, where the
# mock backend validates every request and response against it (router.ts).
#
# Copies from a local secret-project-331 checkout; vendor from a pushed
# `master` so `--check-source` can fetch the recorded rev.
#
# Drift gating:
#   * `--check`: byte-compare against the sibling checkout; local use only.
#   * `--check-stamp`: verifies the spec still matches the committed provenance
#     stamp (source rev + sha256), catching hand-edits. Needs no checkout; this
#     is the CI gate (.github/workflows/test.yml).
#   * `--check-source`: fetches the spec at the stamp's source_rev and
#     byte-compares; the only layer that catches a stamp refreshed from a dirty
#     or unpushed checkout. Needs network.
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

if [ "$MODE" = "--check-stamp" ]; then
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR"
  exit $?
fi

# --check-source needs the recorded rev to be reachable on a pushed branch.
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

# default: (re-)vendor. Byte-for-byte so --check can diff against the sibling.
cp "$SOURCE" "$TARGET"

REV="$(git -C "$SP331_CHECKOUT" rev-parse HEAD 2>/dev/null || echo "unknown")"
SHA="$(sha256_of "$TARGET")"

write_stamp "$STAMP" \
  "Provenance stamp for the vendored exercise-services client OpenAPI spec. Written by bin/updateLangsOpenapi.sh; do not hand-edit. CI asserts the vendored spec's sha256 matches the value below via 'bin/updateLangsOpenapi.sh --check-stamp', catching a hand-edit that never went through re-vendoring." \
  source_repo=secret-project-331 source_rev="$REV" source_url="$SOURCE_URL" sha256="$SHA"

echo "Vendored $SOURCE (secret-project-331 rev $REV) -> $TARGET"
echo "Wrote provenance stamp $STAMP (sha256 $SHA)"
echo "The mooc mock backend (backend/mooc/) validates against this document."
