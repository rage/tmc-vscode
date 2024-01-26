#!/bin/bash

# requires @vscode/vsce
# the PRERELEASE env var can be set to "--pre-release" to package as a pre-release

# clean old artifacts to ensure that local packages match the CI where they don't exist
# otherwise, a package could work locally because some file happened to be there that's not there in CI
rm ./webview-ui/public/build

# run ci and build webview
npm run ci:all
npm run webview:build

# create package
vsce package ${PRERELEASE}
