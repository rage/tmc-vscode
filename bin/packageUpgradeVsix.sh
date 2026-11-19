#!/bin/bash
set -euo pipefail

# Packages this checkout for the upgrade E2E (playwright/upgrade/) as .vscode-test/upgrade-e2e/next.vsix.
# The version is raised above 3.5.5 when it is not already, so that the extension and VS Code
# both see an update; package.json is restored afterwards.

cd "$(dirname "$0")/.."

backup="$(mktemp)"
cp package.json "$backup"
trap 'cp "$backup" package.json && rm -f "$backup"' EXIT

node -e '
const fs = require("fs")
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"))
const [major, minor, patch] = manifest.version.split(".").map(Number)
if (major < 3 || (major === 3 && (minor < 5 || (minor === 5 && patch <= 5)))) {
  manifest.version = "4.0.0"
  fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n")
}
'

bash bin/package.bash

mkdir -p .vscode-test/upgrade-e2e
mv ./*.vsix .vscode-test/upgrade-e2e/next.vsix
