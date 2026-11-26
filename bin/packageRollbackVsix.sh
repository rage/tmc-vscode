#!/bin/bash
set -euo pipefail

# Packages origin/rollback-3.5.x, the build users fall back to when a 4.x release is pulled, as
# .vscode-test/upgrade-e2e/rollback.vsix for the upgrade E2E (playwright/upgrade/).
# Builds in a throwaway worktree, so this checkout is left alone.

cd "$(dirname "$0")/.."

git fetch --quiet origin rollback-3.5.x
worktree="$(mktemp -d)"
trap 'git worktree remove --force "$worktree" >/dev/null 2>&1 || true' EXIT
git -c core.hooksPath=/dev/null worktree add --quiet --detach "$worktree" origin/rollback-3.5.x
git -C "$worktree" submodule update --init --quiet 2>/dev/null || true

(cd "$worktree" && bash bin/package.bash)

mkdir -p .vscode-test/upgrade-e2e
mv "$worktree"/*.vsix .vscode-test/upgrade-e2e/rollback.vsix
