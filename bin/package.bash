#!/bin/bash
set -euxo pipefail

# the script takes an argument that can be set to "--pre-release" to package as a pre-release
PRERELEASE_ARG=${1:-""}

# clean old artifacts to ensure that local packages match the CI where they don't exist
# otherwise, a package could work locally because some file happened to be there that's not there in CI
rm -rf ./dist
rm -rf ./webview-ui/public/build
rm -f ./*.vsix

# run ci and build webview
pnpm install --frozen-lockfile
pnpm run webview:build

# create package
# --no-dependencies: esbuild bundles everything into dist/, so runtime
# node_modules aren't shipped; also avoids @vscode/vsce choking on pnpm's
# symlinked node_modules layout.
BACKEND=production pnpm exec vsce package --no-dependencies "${PRERELEASE_ARG}"

# The listing is what reaches users, and nothing else fails when a source tree, a
# test bundle, the coverage report or the docs slip into it -- so assert their
# absence here rather than trusting .vscodeignore to stay right.
LISTING=$(BACKEND=production pnpm exec vsce ls --no-dependencies)
if echo "${LISTING}" | grep -E '(^|/)(src|backend|playwright|coverage|docs|node_modules)/|^dist/integration|\.map$|\.test\.js$'; then
  echo "The paths above would ship to users; fix .vscodeignore." >&2
  exit 1
fi

VSIX=$(echo ./*.vsix)
echo "Packaged ${VSIX}: $(wc -c <"${VSIX}") bytes, $(echo "${LISTING}" | wc -l) files."
