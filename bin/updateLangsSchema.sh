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
# branch. Once a tmc-langs release ships the schema, switch this script to
# fetch from GitHub releases/raw for the pinned TMC_LANGS_RUST_VERSION, the
# same way bin/updateLangs.bash fetches bindings.d.ts:
#   https://raw.githubusercontent.com/rage/tmc-langs-rust/<version>/crates/tmc-langs-cli/bindings.schema.json
#
# Run via `npm run vendor:langs-schema`. This step alone only re-vendors the
# JSON Schema; it does not regenerate the zod/TS output. Follow it with
# `npm run generate:langs-schema` (bin/generateLangsSchema.mjs) to regenerate
# shared/generated/langs from the freshly vendored schema, then update the
# hand-written shim in shared/langsSchema.ts to match and run the contract
# test. The two steps are split so CI can run `generate:langs-schema` alone
# (from the committed vendored schema) to check for drift, without needing a
# tmc-langs-rust checkout to vendor from.
set -euo pipefail

cd "$(dirname "$0")/.."

LANGS_CHECKOUT="${TMC_LANGS_RUST_CHECKOUT:-../tmc-langs-rust}"
SOURCE="$LANGS_CHECKOUT/crates/tmc-langs-cli/bindings.schema.json"
TARGET="./shared/bindings.schema.json"

if [ ! -f "$SOURCE" ]; then
  echo "error: $SOURCE not found." >&2
  echo "Set TMC_LANGS_RUST_CHECKOUT to your tmc-langs-rust checkout." >&2
  exit 1
fi

# sanity check: must be valid JSON
node -e "JSON.parse(require('fs').readFileSync('$SOURCE', 'utf8'))"

# copy byte-for-byte so the file can be diffed against
# `tmc-langs-cli schema` output directly
cp "$SOURCE" "$TARGET"

REV="$(git -C "$LANGS_CHECKOUT" rev-parse HEAD 2>/dev/null || echo "unknown")"
echo "Vendored $SOURCE (tmc-langs-rust rev $REV) -> $TARGET"
echo "Remember to update shared/langsSchema.ts and run the contract test."
