#!/bin/bash
set -euxo pipefail

# requires @vscode/vsce
# the script takes an argument that can be set to "--pre-release" to package as a pre-release
PRERELEASE_ARG=${1:-""}

# clean old artifacts to ensure that local packages match the CI where they don't exist
# otherwise, a package could work locally because some file happened to be there that's not there in CI
rm -rf ./dist
rm -rf ./webview-ui/public/build

# run ci and build webview
pnpm install --frozen-lockfile
pnpm run webview:build

# create package
# --no-dependencies: esbuild bundles everything into dist/, so runtime
# node_modules aren't shipped; also avoids @vscode/vsce choking on pnpm's
# symlinked node_modules layout.
BACKEND=production pnpm dlx @vscode/vsce package --no-dependencies "${PRERELEASE_ARG}"
