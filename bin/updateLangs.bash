#!/bin/bash
set -euxo pipefail

if [ -z ${1+x} ]; then
  echo -e "Missing version argument"
  exit 1
fi

VERSION="$1"
BINDINGS_DOWNLOAD_URL="https://raw.githubusercontent.com/rage/tmc-langs-rust/${VERSION}/crates/tmc-langs-cli/bindings.d.ts"
BINDINGS_DOWNLOAD_TARGET="./shared/langsSchema.ts"

echo "Removing old schema"
rm "$BINDINGS_DOWNLOAD_TARGET"

echo "Downloading generated type definitions"
GENERATED=$(curl "$BINDINGS_DOWNLOAD_URL")

# write version to the file
printf "// VERSION=%s\n" "$VERSION" > "$BINDINGS_DOWNLOAD_TARGET"
# write URL to the file to make it easy to keep track of the version
printf "// %s\n\n" "$BINDINGS_DOWNLOAD_URL" >> "$BINDINGS_DOWNLOAD_TARGET"
echo "$GENERATED" | npx prettier --parser typescript >> "$BINDINGS_DOWNLOAD_TARGET"

# update version number
sed -i s/"TMC_LANGS_RUST_VERSION = .*"/"TMC_LANGS_RUST_VERSION = \"${VERSION}\";/" ./config.js
