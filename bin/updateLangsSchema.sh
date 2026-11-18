#!/bin/bash
# Re-vendors the tmc-langs-cli output contract JSON Schema: the `bindings.schema-<version>.json`
# asset of the tmc-langs-rust release that config.js's TMC_LANGS_RUST_VERSION pins.
#
# shared/bindings.schema.json is not used at runtime; it is the drift reference for the generated
# zod schemas (src/test/langsSchema.test.ts) and for the startup self-check
# (src/init/verifyCliSchema.ts), which diffs it against `tmc-langs-cli schema`.
#
# Drift gating, mirroring bin/updateLangsOpenapi.sh:
#   * A provenance stamp (shared/bindings.schema.source.json: source release + sha256) lets CI
#     catch a hand-edited schema. `--check-stamp` verifies it offline.
#   * `--check` fetches the pinned release's schema and byte-compares, which also catches a pin
#     bumped without re-vendoring. Needs network.
#   * `--from-checkout` vendors the committed schema of a local tmc-langs-rust checkout
#     (TMC_LANGS_RUST_DIR, default ../tmc-langs-rust) for an unreleased CLI. Its stamp names the
#     rev and no release, so `--check` fails until the pin is bumped and re-vendored.
#
# Run via `pnpm run vendor:langs-schema`, then `pnpm run generate:langs-schema` to regenerate
# shared/generated/langs; the steps are split so CI can run the generator alone.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/stamp.sh"

cd "$SCRIPT_DIR/.."

TARGET="./shared/bindings.schema.json"
STAMP="./shared/bindings.schema.source.json"
REVENDOR="pnpm run vendor:langs-schema"
STAMP_DESCRIPTION="Provenance stamp for the vendored tmc-langs-cli output contract schema. Written by bin/updateLangsSchema.sh; do not hand-edit. CI asserts the vendored schema's sha256 matches the value below via 'bin/updateLangsSchema.sh --check-stamp', catching a hand-edit that never went through re-vendoring."

MODE="$(vendor_mode "$@")"

if [ "$MODE" = "--check-stamp" ]; then
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR"
  exit $?
fi

if [ "$MODE" = "--from-checkout" ]; then
  LANGS_REPO="${TMC_LANGS_RUST_DIR:-../tmc-langs-rust}"
  SOURCE="$LANGS_REPO/crates/tmc-langs-cli/bindings.schema.json"
  if [ ! -f "$SOURCE" ]; then
    echo "error: $SOURCE not found. Set TMC_LANGS_RUST_DIR to your tmc-langs-rust checkout." >&2
    exit 1
  fi
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$SOURCE"
  cp "$SOURCE" "$TARGET"
  REV="$(git -C "$LANGS_REPO" rev-parse HEAD 2>/dev/null || echo "unknown")"
  SHA="$(sha256_of "$TARGET")"
  write_stamp "$STAMP" "$STAMP_DESCRIPTION" \
    source_repo=tmc-langs-rust source_release=unreleased source_rev="$REV" sha256="$SHA"
  echo "Vendored $SOURCE (tmc-langs-rust rev $REV, unreleased) -> $TARGET"
  exit 0
fi

VERSION="$(node -p 'JSON.parse(require("./config.js").productionApi.__TMC_LANGS_VERSION__)')"
SOURCE_URL="https://github.com/rage/tmc-langs-rust/releases/download/$VERSION/bindings.schema-$VERSION.json"

fetched="$(mktemp)"
trap 'rm -f "$fetched"' EXIT
if ! curl -fsSL "$SOURCE_URL" -o "$fetched"; then
  echo "error: could not fetch $SOURCE_URL" >&2
  echo "Is tmc-langs-rust $VERSION released, with its schema attached?" >&2
  exit 1
fi

# sanity check: must be valid JSON
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$fetched"

if [ "$MODE" = "--check" ]; then
  status=0
  if diff -q "$fetched" "$TARGET" >/dev/null 2>&1; then
    echo "OK: vendored langs schema is byte-identical to $SOURCE_URL"
  else
    echo "DRIFT: $TARGET differs from $SOURCE_URL" >&2
    echo "Run '$REVENDOR' to re-vendor." >&2
    diff "$fetched" "$TARGET" >&2 || true
    status=1
  fi
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR" || status=1
  exit $status
fi

# default: (re-)vendor, byte-for-byte so the file can be diffed against
# `tmc-langs-cli schema` output directly
cp "$fetched" "$TARGET"

SHA="$(sha256_of "$TARGET")"

write_stamp "$STAMP" "$STAMP_DESCRIPTION" \
  source_repo=tmc-langs-rust source_release="$VERSION" source_url="$SOURCE_URL" sha256="$SHA"

echo "Vendored $SOURCE_URL -> $TARGET"
echo "Wrote provenance stamp $STAMP (sha256 $SHA)"
echo "Regenerate with 'pnpm run generate:langs-schema' and run the contract test."
