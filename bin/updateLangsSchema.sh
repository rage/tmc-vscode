#!/bin/bash
# Re-vendors the tmc-langs-cli output contract JSON Schema into this repo.
#
# The schema (crates/tmc-langs-cli/bindings.schema.json) is generated in
# tmc-langs-rust from the same serde-annotated Rust types that serialize the
# CLI's stdout, via `cargo test generate_cli_bindings_schema -- --ignored`
# (and is also printed at runtime by the `tmc-langs-cli schema` subcommand).
#
# The vendored copy at shared/bindings.schema.json is NOT used at runtime.
# It is the drift reference for the hand-written zod schemas in
# shared/langsSchema.ts: the contract test (src/test/langsSchema.test.ts)
# cross-checks the zod schemas against it, and a future startup self-check
# can diff it against `tmc-langs-cli schema` output from the actual binary.
#
# For now this copies from a local tmc-langs-rust checkout, because the
# extension currently tracks the unreleased `programming-exercise-migration`
# branch. Once a tmc-langs release ships the schema, switch this script to
# fetch from GitHub releases/raw for the pinned TMC_LANGS_RUST_VERSION, the
# same way bin/updateLangs.bash fetches bindings.d.ts:
#   https://raw.githubusercontent.com/rage/tmc-langs-rust/<version>/crates/tmc-langs-cli/bindings.schema.json
#
# After updating the schema, update the hand-written zod schemas in
# shared/langsSchema.ts to match, then run the contract test.
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
