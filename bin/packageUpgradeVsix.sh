#!/bin/bash
set -euo pipefail

# Packages this checkout for the upgrade E2E (playwright/upgrade/) as .vscode-test/upgrade-e2e/next.vsix,
# versioned above the 3.x release the E2E installs first so that the extension and VS Code both
# see an update.

cd "$(dirname "$0")/.."

legacy=$(sed -n 's/^  version: "\([0-9.]*\)",$/\1/p' playwright/upgrade/installedExtension.ts)
if [[ -z "$legacy" ]]; then
  echo "No 3.x version found in playwright/upgrade/installedExtension.ts" >&2
  exit 1
fi
version=$(node -p 'require("./package.json").version')
if [[ $(printf '%s\n' "$legacy" "$version" | sort -V | tail -n 1) == "$legacy" ]]; then
  version="$((${legacy%%.*} + 1)).0.0"
fi

VSIX_VERSION="$version" bash bin/package.bash

mkdir -p .vscode-test/upgrade-e2e
mv ./*.vsix .vscode-test/upgrade-e2e/next.vsix
