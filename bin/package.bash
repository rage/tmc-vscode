#!/bin/bash
set -euxo pipefail

# the script takes an argument that can be set to "--pre-release" to package as a pre-release
PRERELEASE_ARG=${1:-""}
# VSIX_VERSION packages as that version, leaving package.json as it is.
VERSION_ARGS=()
if [[ -n "${VSIX_VERSION:-}" ]]; then
  VERSION_ARGS=("${VSIX_VERSION}" --no-update-package-json)
fi

# Pre-releases list courses.mooc.fi courses by default; stable releases keep them opt-in.
COURSES_MOOC_FI_DEFAULT=false
if [[ "${PRERELEASE_ARG}" == "--pre-release" ]]; then
  COURSES_MOOC_FI_DEFAULT=true
  cp package.json package.json.orig
  trap 'mv package.json.orig package.json' EXIT
  node -e '
    const fs = require("fs")
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"))
    manifest.contributes.configuration.properties["testMyCode.experimental.coursesMoocFi"].default = true
    fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n")
  '
fi

# clean old artifacts to ensure that local packages match the CI where they don't exist
# otherwise, a package could work locally because some file happened to be there that's not there in CI
rm -rf ./dist
rm -rf ./webview-ui/public/build
rm -f ./*.vsix

# run ci and build webview
pnpm install --frozen-lockfile
pnpm run webview:build

# create package
# --no-dependencies: esbuild bundles dist/, and vsce chokes on pnpm's symlinked
# node_modules.
BACKEND=production pnpm exec vsce package --no-dependencies ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} "${PRERELEASE_ARG}"

# Nothing else fails when sources, test bundles, coverage or docs slip into the
# VSIX, so assert their absence rather than trust .vscodeignore.
LISTING=$(BACKEND=production pnpm exec vsce ls --no-dependencies)
if echo "${LISTING}" | grep -E '(^|/)(src|backend|playwright|coverage|docs|node_modules|visual|a11y)/|^dist/integration|\.map$|\.test\.js$'; then
  echo "The paths above would ship to users; fix .vscodeignore." >&2
  exit 1
fi

VSIX=$(echo ./*.vsix)
PACKAGED_DEFAULT=$(unzip -p "${VSIX}" extension/package.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).contributes.configuration.properties["testMyCode.experimental.coursesMoocFi"].default')
if [[ "${PACKAGED_DEFAULT}" != "${COURSES_MOOC_FI_DEFAULT}" ]]; then
  echo "The VSIX defaults testMyCode.experimental.coursesMoocFi to ${PACKAGED_DEFAULT}, not ${COURSES_MOOC_FI_DEFAULT}." >&2
  exit 1
fi
echo "Packaged ${VSIX}: $(wc -c <"${VSIX}") bytes, $(echo "${LISTING}" | wc -l) files."
