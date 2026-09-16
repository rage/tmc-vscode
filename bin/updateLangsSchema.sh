#!/bin/bash
# Re-vendors the tmc-langs-cli output contract JSON Schema into this repo.
#
# The schema (crates/tmc-langs-cli/bindings.schema.json) is generated in
# tmc-langs-rust from the same serde-annotated Rust types that serialize the
# CLI's stdout, via `cargo test generate_cli_bindings_schema -- --ignored`
# (and is also printed at runtime by the `tmc-langs-cli schema` subcommand).
#
# The vendored copy at shared/bindings.schema.json is NOT used at runtime.
# It is the drift reference for the generated zod schemas: the contract test
# (src/test/langsSchema.test.ts) cross-checks them against it, and the startup
# self-check (src/init/verifyCliSchema.ts) diffs it against `tmc-langs-cli
# schema` output from the actual binary.
#
# For now this copies from a local tmc-langs-rust checkout, because the
# extension currently tracks the unreleased `programming-exercise-migration`
# branch. Once a tmc-langs release ships the schema, point SOURCE at the raw URL
# for the TMC_LANGS_RUST_VERSION config.js pins, so the vendored schema is the
# one the shipped binary actually emits:
#   https://raw.githubusercontent.com/rage/tmc-langs-rust/<version>/crates/tmc-langs-cli/bindings.schema.json
#
# Drift gating (two layers, mirroring bin/updateLangsOpenapi.sh):
#   * Byte-compare against the sibling checkout (`--check`) needs that checkout,
#     so it is for local use before committing a schema-touching change.
#   * A provenance STAMP committed next to the vendored schema
#     (shared/bindings.schema.source.json: the source rev + the schema's sha256)
#     lets CI verify the vendored schema has not been hand-edited without a
#     re-vendor. `--check-stamp` performs that check and needs NO sibling
#     checkout, so it is the gate CI runs (see .github/workflows/test.yml).
#
# Run via `pnpm run vendor:langs-schema`. This step alone only re-vendors the
# JSON Schema; it does not regenerate the zod/TS output. Follow it with
# `pnpm run generate:langs-schema` (bin/generateLangsSchema.mjs) to regenerate
# shared/generated/langs from the freshly vendored schema, then run the contract
# test. The two steps are split so CI can run `generate:langs-schema` alone
# (from the committed vendored schema) to check for drift, without needing a
# tmc-langs-rust checkout to vendor from.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/stamp.sh"

cd "$SCRIPT_DIR/.."

LANGS_CHECKOUT="${TMC_LANGS_RUST_CHECKOUT:-../tmc-langs-rust}"
SOURCE="$LANGS_CHECKOUT/crates/tmc-langs-cli/bindings.schema.json"
TARGET="./shared/bindings.schema.json"
STAMP="./shared/bindings.schema.source.json"
REVENDOR="pnpm run vendor:langs-schema"

MODE="$(vendor_mode "$@")"

if [ "$MODE" = "--check-stamp" ]; then
  verify_stamp "$TARGET" "$STAMP" "$REVENDOR"
  exit $?
fi

# The remaining modes read the sibling tmc-langs-rust checkout.
if [ ! -f "$SOURCE" ]; then
  echo "error: $SOURCE not found." >&2
  echo "Set TMC_LANGS_RUST_CHECKOUT to your tmc-langs-rust checkout." >&2
  exit 1
fi

# sanity check: must be valid JSON
node -e "JSON.parse(require('fs').readFileSync('$SOURCE', 'utf8'))"

if [ "$MODE" = "--check" ]; then
  status=0
  if diff -q "$SOURCE" "$TARGET" >/dev/null 2>&1; then
    echo "OK: vendored langs schema is byte-identical to $SOURCE"
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
# copy byte-for-byte so the file can be diffed against
# `tmc-langs-cli schema` output directly
cp "$SOURCE" "$TARGET"

REV="$(git -C "$LANGS_CHECKOUT" rev-parse HEAD 2>/dev/null || echo "unknown")"
SHA="$(sha256_of "$TARGET")"

# The sha256 is of the vendored schema itself (TARGET), so re-formatting this
# stamp does not affect it.
cat > "$STAMP" <<EOF
{
  "//": "Provenance stamp for the vendored tmc-langs-cli output contract schema. Written by bin/updateLangsSchema.sh; do not hand-edit. CI asserts the vendored schema's sha256 matches the value below via 'bin/updateLangsSchema.sh --check-stamp', catching a hand-edit that never went through re-vendoring.",
  "source_repo": "tmc-langs-rust",
  "source_rev": "$REV",
  "sha256": "$SHA",
  "vendoredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Normalise the stamp to the repo's formatting so format:check stays green.
pnpm exec oxfmt "$STAMP" >/dev/null 2>&1 || true

echo "Vendored $SOURCE (tmc-langs-rust rev $REV) -> $TARGET"
echo "Wrote provenance stamp $STAMP (sha256 $SHA)"
echo "Regenerate with 'pnpm run generate:langs-schema' and run the contract test."
