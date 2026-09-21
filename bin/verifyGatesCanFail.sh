#!/bin/bash
# Breaks one input per CI gate, asserts the gate fails on it, and restores it.
#
# A gate nobody has seen fail is indistinguishable from one that cannot. Every
# gate covered here consumes a glob, a generated file or a vendored artifact,
# and each of those has a way of going empty or stale that exits 0 on its own.
# The matching green half is the rest of .github/workflows/test.yml running the
# same gates unbroken on the same commit, so this script proves the red half and
# that it put the tree back.
#
# It edits tracked files in place, so run it on a checkout you are not also
# editing. The one git-index case runs against a scratch index and never touches
# the checkout's own.
set -uo pipefail

cd "$(dirname "$0")/.."
source bin/lib/stamp.sh

scratch="$(mktemp -d)"
originals="$scratch/originals"
failures=0
brokeBackendPackage=0
brokeMockSuite=0
stubbedIntegrationBundle=0
brokeVendoredSchema=0
addedLintProbe=0

PROBE_SPEC="playwright/tests/gateProbe.spec.ts"

# Files a case edits in place, checked byte-for-byte once every case has run.
recordOriginal() {
  if [ -f "$1" ]; then
    printf '%s  %s\n' "$(sha256_of "$1")" "$1" >> "$originals"
  fi
}

restoreAll() {
  if [ "$brokeBackendPackage" = 1 ]; then
    cp "$scratch/backend-package.json" backend/package.json
    brokeBackendPackage=0
  fi
  if [ "$brokeMockSuite" = 1 ]; then
    cp "$scratch/conformance.test.ts" backend/mooc/conformance.test.ts
    brokeMockSuite=0
  fi
  if [ "$stubbedIntegrationBundle" = 1 ]; then
    rm -f dist/integration.spec.js
    if [ -f "$scratch/integration.spec.js" ]; then
      mv "$scratch/integration.spec.js" dist/integration.spec.js
    fi
    stubbedIntegrationBundle=0
  fi
  if [ "$brokeVendoredSchema" = 1 ]; then
    cp "$scratch/bindings.schema.json" shared/bindings.schema.json
    brokeVendoredSchema=0
  fi
  if [ "$addedLintProbe" = 1 ]; then
    rm -f "$PROBE_SPEC"
    addedLintProbe=0
  fi
}
trap 'restoreAll; rm -rf "$scratch"' EXIT

# expectGateFailure <case name> <expected output fragment> <gate command...>
expectGateFailure() {
  local name=$1 expected=$2
  shift 2
  local log="$scratch/case.log"
  if "$@" > "$log" 2>&1; then
    echo "FAIL: $name - the gate passed on broken input"
    head -n 40 "$log" | sed 's/^/    /'
    failures=$((failures + 1))
    return
  fi
  if ! grep -qF "$expected" "$log"; then
    echo "FAIL: $name - the gate failed, but not on '$expected'"
    head -n 40 "$log" | sed 's/^/    /'
    failures=$((failures + 1))
    return
  fi
  echo "OK: $name"
}

for tracked in backend/package.json backend/mooc/conformance.test.ts \
  shared/bindings.schema.json shared/generated/langs/zod.gen.ts \
  shared/generated/langs/index.ts dist/integration.spec.js; do
  recordOriginal "$tracked"
done

cp backend/package.json "$scratch/backend-package.json"
brokeBackendPackage=1
node -e 'const fs = require("fs"); const f = "backend/package.json"; const p = JSON.parse(fs.readFileSync(f, "utf8")); p.scripts.test = p.scripts.test.replace("**/*.test.ts", "no-such-directory/**/*.test.ts"); fs.writeFileSync(f, JSON.stringify(p, null, 2))'
expectGateFailure "mock backend floor / a test glob matching no files" \
  "expected at least" \
  bash bin/runMockBackendTests.sh
restoreAll

cp backend/mooc/conformance.test.ts "$scratch/conformance.test.ts"
brokeMockSuite=1
sed 's/^describe(/describe.skip(/' "$scratch/conformance.test.ts" > backend/mooc/conformance.test.ts
expectGateFailure "mock backend floor / a skipped suite" \
  "expected at least" \
  bash bin/runMockBackendTests.sh
restoreAll

mkdir -p dist
if [ -f dist/integration.spec.js ]; then
  mv dist/integration.spec.js "$scratch/integration.spec.js"
fi
stubbedIntegrationBundle=1
printf '// A bundle that reaches the loader but declares no tests.\n' > dist/integration.spec.js
expectGateFailure "integration suite floor / a bundle declaring no tests" \
  "expected at least" \
  node -e 'require("./bin/integrationTestLoader.js").run().catch((e) => { console.error(e.message); process.exitCode = 1 })'
restoreAll

# A scratch index, so dropping a generated file from it cannot disturb the
# checkout's own. git honours GIT_INDEX_FILE, so the gate itself runs unmodified.
export GIT_INDEX_FILE="$scratch/gates.index"
git read-tree HEAD
git rm --cached --quiet -- shared/generated/langs/zod.gen.ts
expectGateFailure "langs schema drift / a generated file that was never committed" \
  "shared/generated/langs/zod.gen.ts" \
  bash bin/checkLangsSchemaDrift.sh
unset GIT_INDEX_FILE

cp shared/bindings.schema.json "$scratch/bindings.schema.json"
brokeVendoredSchema=1
printf '\n' >> shared/bindings.schema.json
expectGateFailure "vendored artifact stamp / a hand-edited schema" \
  "STAMP MISMATCH" \
  pnpm run vendor:langs-schema -- --check-stamp
restoreAll

addedLintProbe=1
cat > "$PROBE_SPEC" << 'EOF'
import { expect, test } from "@playwright/test"

test("the playwright lint rules are loaded", async ({ page }) => {
  expect(page).toHaveTitle("never awaited")
})
EOF
expectGateFailure "playwright lint rules / an un-awaited expect" \
  "playwright(missing-playwright-await)" \
  pnpm run lint
restoreAll

while read -r sha path; do
  if [ ! -f "$path" ] || [ "$(sha256_of "$path")" != "$sha" ]; then
    echo "FAIL: $path was not restored"
    failures=$((failures + 1))
  fi
done < "$originals"

if [ -e "$PROBE_SPEC" ]; then
  echo "FAIL: $PROBE_SPEC was left behind"
  failures=$((failures + 1))
fi

if [ "$failures" != 0 ]; then
  echo "$failures gate case(s) failed"
  exit 1
fi

echo "All gate cases failed as they should"
