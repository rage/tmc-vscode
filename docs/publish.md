# Publishing a release

- [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Pre-release extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions)

A release is published by pushing a tag. CI (`.github/workflows/build-and-upload.yml`) builds the VSIX once and publishes it to the Visual Studio Marketplace and to Open VSX in two separate jobs.

## Prerequisites

- The repository secrets `VSCE_PUBLISH_TOKEN` (an Azure DevOps personal access token for the `moocfi` publisher) and `OVSX_PUBLISHER_TOKEN` (an Open VSX access token) are valid.
- The repository has a GitHub environment named `release` (Settings → Environments) with required reviewers. Both publish jobs wait in it for approval.

## Stable or pre-release

The marketplaces take only `X.Y.Z` versions, so a pre-release is told apart by its tag, not its version:

- `vX.Y.Z` publishes a stable release.
- `vX.Y.Z-prerelease` publishes the same build with `--pre-release`. Users get it only after choosing "Switch to Pre-Release Version" on the extension's page in VS Code; see [insider.md](insider.md).

VS Code updates a pre-release user to the highest version, stable or pre-release. Follow the marketplace's convention of even minor versions for stable releases and odd ones for pre-releases (for example stable 4.0.x and 4.2.x, pre-release 4.1.x).

## Steps

1. Set the `version` field in [package.json](../package.json) to `X.Y.Z`. There is no other file to bump: `pnpm-lock.yaml` does not record the extension's own version.
2. In [CHANGELOG.md](../CHANGELOG.md), rename `[Unreleased]` to the exact header `[X.Y.Z] - YYYY-MM-DD` and start a new empty `[Unreleased]` section above it. Write for users: what's new, what changed, what was removed.
3. If new files should not ship, update `.vscodeignore`. `bin/package.bash` fails the build when sources, tests, docs or source maps end up in the VSIX. Most SVG files [can't be included](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions); convert icons to PNG.
4. Commit and merge these changes to `master`.
5. On an up-to-date `master`, run `pnpm run release vX.Y.Z` (or `vX.Y.Z-prerelease`), which runs `bin/publishRelease.sh`. It runs `bin/validateRelease.sh`, which checks that the tag matches `package.json`, that `CHANGELOG.md` has the version's entry, and that the TMC-langs CLI builds for every platform exist. It then shows the commit, asks for confirmation, and pushes an annotated tag.
6. Create a GitHub release from the tag. The workflow runs on the release, validates it again, packages the VSIX and uploads it as the `packaged-extension` artifact.
7. Approve the two publish jobs in the workflow run.

## If publishing fails

- **One marketplace failed** (for example an expired token): fix the cause, such as the secret, and use "Re-run failed jobs" on the workflow run. It publishes the VSIX the run already built; the other marketplace is not published again.
- **Validation or packaging failed:** nothing was published. Delete the release and the tag, fix the problem on `master`, and start again from step 5:
  1. `git tag -d vX.Y.Z`
  2. `git push origin --delete vX.Y.Z`
