#!/bin/bash
set -euo pipefail

# Builds tmc-langs-cli from the sibling ../tmc-langs-rust checkout and installs
# it where the test harness serves the CLI (backend/cli), so BOTH the
# integration tier (src/test-integration/tmc_langs_cli.spec.ts, which points
# Langs straight at backend/cli) and Playwright (mockBackend profile downloads
# the CLI from the mock backend, which serves backend/cli) transparently use
# the locally-built binary instead of the released one.
#
# LOCAL DEV/TEST ONLY. CI is unchanged and keeps using the released CLI.
#
# Version-pin reconciliation: config.js pins a single TMC_LANGS_RUST_VERSION
# (shared by all three build profiles) and the harness locates the CLI by the
# `...-<version>` filename. Rather than split or bump that pin (which would
# touch the production download path), we install the local build UNDER THE
# PINNED FILENAME. The real version is still reported by `<cli> --version`
# (newer than the version pinned in config.js, for the migration branch),
# which is what the integration suite uses to decide whether to run the
# migration-contract tests. So: pinned name on disk, honest version over
# --version.
#
# backend/cli is gitignored, so nothing here is ever committed.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANGS_REPO="${TMC_LANGS_RUST_DIR:-$REPO_ROOT/../tmc-langs-rust}"

if [ ! -d "$LANGS_REPO" ]; then
  echo "tmc-langs-rust checkout not found at $LANGS_REPO" >&2
  echo "Set TMC_LANGS_RUST_DIR to override." >&2
  exit 1
fi

# cargo may only be on PATH via the rustup env script.
if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "Building tmc-langs-cli (release) from $LANGS_REPO ..."
cargo build --release -p tmc-langs-cli --manifest-path "$LANGS_REPO/Cargo.toml"

BINARY="$LANGS_REPO/target/release/tmc-langs-cli"
if [ ! -f "$BINARY" ]; then
  BINARY="$LANGS_REPO/target/release/tmc-langs-cli.exe"
fi
if [ ! -f "$BINARY" ]; then
  echo "Built binary not found under $LANGS_REPO/target/release" >&2
  exit 1
fi

# Resolve the pinned filename the harness expects (platform triple + version)
# using the same helper the extension uses.
FILENAME="$(cd "$REPO_ROOT" && node -e 'const {getLangsCLIForPlatform,getPlatform}=require("./src/utilities/env.js");const cfg=require("./config.js");const v=JSON.parse(cfg.mockBackend.__TMC_LANGS_VERSION__);process.stdout.write(getLangsCLIForPlatform(getPlatform(),v))')"

CLI_DIR="$REPO_ROOT/backend/cli"
DEST="$CLI_DIR/$FILENAME"
mkdir -p "$CLI_DIR"

cp "$BINARY" "$DEST"
chmod +x "$DEST"

# Regenerate the checksum the extension verifies the CLI against.
( cd "$CLI_DIR" && sha256sum "$FILENAME" > "$FILENAME.sha256" )

echo "Installed local tmc-langs-cli -> $DEST"
echo -n "Version: "
"$DEST" --version

cat <<EOF

Done. To use it:
  - integration: pnpm run test:integration
  - playwright:  pnpm run backend:start   (in one shell)
                 pnpm run playwright-test:local
To restore the released CLI: rm -rf backend/cli && (cd backend && pnpm run setup)
EOF
