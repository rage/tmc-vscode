#!/bin/bash
# Fails unless shared/generated/langs is exactly what bin/generateLangsSchema.mjs
# produces from the committed shared/bindings.schema.json.
#
# `git diff` ignores untracked files, so --intent-to-add makes a never-committed generated file
# show as an addition. The vendored schema is covered by its provenance stamp
# (bin/updateLangsSchema.sh --check-stamp).
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm run generate:langs-schema
git add --intent-to-add -- shared/generated
git diff --exit-code -- shared/generated
