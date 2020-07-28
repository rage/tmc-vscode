# Deployment to marketplace
* [Official documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### Prerequisites
* Personal Access Token from Azure DevOps is valid and added to Github secrets.

### Steps for publishing to VSCode Marketplace

1. Update the version field (`X.Y.Z`) in [package.json](https://github.com/rage/tmc-vscode/blob/master/package.json) and [package-lock.json](https://github.com/rage/tmc-vscode/blob/master/package-lock.json).
2. Update [CHANGELOG.md](https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md)
    - Add a new entry with the exact header `[X.Y.Z] - YYYY-MM-DD`
    - List any additions and changes to the extension. You may use [keep a changelog](https://keepachangelog.com/en/1.0.0/) as a reference.
3. Update `.vscodeignore` for any files that you don't want to include with the release.
    - Most SVG files [can't be included](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions). For icons, you may convert them to PNG beforehand.
4. Commit and merge these changes to the master branch
5. Run the following script on master branch to create a new release tag: `bin/publishRelease.sh vX.Y.Z`

CI will now detect the tag and automatically publishes a new version, given that above conditions are met and CI passes.

#### If publishing fails

The CI operation may fail if, for example, the changelog entry is missing or if the publication token is invalid. In these cases you may remove the tag before starting over:
1. For local: `git tag -d vX.Y.Z`
2. For remote: `git push origin --delete vX.Y.Z`
3. Fix any issues you encountered and try to publish again.