#!/bin/bash
# Fails unless shared/generated/langs is exactly what bin/generateLangsSchema.mjs
# produces from the committed shared/bindings.schema.json.
#
# `git diff` does not see untracked files, so a generated file that was never
# committed would drift undetected; --intent-to-add puts it in the diff as an
# addition. The vendored schema this generates from is covered separately by its
# provenance stamp (bin/updateLangsSchema.sh --check-stamp).
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm run generate:langs-schema
git add --intent-to-add -- shared/generated
git diff --exit-code -- shared/generated
