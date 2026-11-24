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

## Release order and rollback

The plan is a pre-release 4.1.x first, then stable 4.0.0. The package version therefore moves down between the two, and the changelog gains `[4.1.0]` above `[4.0.0]`; `bin/validateRelease.sh` accepts that, since it checks only the exact `[X.Y.Z] - YYYY-MM-DD` header of the tagged version.

The rollback build on the `rollback-3.5.x` branch is versioned `4.99.0` so the marketplaces accept it above 4.x. VS Code installs nothing lower for users who received it, so **the forward version after a rollback is 5.0.0**: 4.0.1, 4.2.0 and every other 4.x would never reach them.

The rollback workflow publishes to both marketplaces in one job, without the `release` environment's approval. Add the environment gate on `rollback-3.5.x` before using it.

## Exit criteria

Before each stable step, write the numbers into the release issue and tick off:

- [ ] **Cohort:** the pre-release is used by at least N students and teachers, covering Windows, macOS and Linux, on VS Code stable and the minimum version.
- [ ] **Soak:** the pre-release has run for at least N days with no open release-blocking issue.
- [ ] **Sign-off per OS:** Windows, macOS and Linux each ticked by someone who ran the login, download, test, submit and restore flows.
- [ ] **Sign-off per editor:** VS Code stable, the minimum version and VSCodium each ticked.
- [ ] **Data loss:** zero reports of lost exercises or lost submissions.
- [ ] **CLI downloads:** the pinned tools download, verify and start on every target `getLangsCLIForPlatform` knows (`src/utilities/env.ts`).
- [ ] **Install guide:** the owner of https://www.mooc.fi/en/installation/vscode has confirmed it describes this version (MOOC.fi login, Courses view).
- [ ] **Account linking:** the table below is filled in and the unlinked share is acceptable.

The release owner chooses N.

### Linked-account counts (to be filled in)

Counts only, from the read-only query for active tmc.mooc.fi users with a linked courses.mooc.fi account:

| measure                             | count | date |
| ----------------------------------- | ----- | ---- |
| active tmc.mooc.fi users            |       |      |
| of those, linked to courses.mooc.fi |       |      |
| unlinked share                      |       |      |

Acceptable unlinked share before the stable release: **to be decided by the project owner**.
