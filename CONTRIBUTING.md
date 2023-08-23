# Contributing

## Where to begin?

You can start by looking through the issues marked with label [`good first issue`](https://github.com/rage/tmc-vscode/labels/good%20first%20issue).

### Getting the code

```
git clone https://github.com/rage/tmc-vscode.git
```

### Prerequisites

-   [Git](https://git-scm.com/)
-   [NodeJS / npm](https://nodejs.org/)
-   [VSCode](https://code.visualstudio.com/)
-   [vsce](https://www.npmjs.com/package/vsce)

### Dependencies

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```
npm ci
```

Repeat the same for the testing backend:

```
cd backend && npm ci && npm run setup
```

### Build

From VSCode, the extension can be launched with `F5` by default.
Automatic build task starts the first time that the extension is launched from VSCode.

**NOTE!** If editing type definitions

You need to kill the webpackBuild task by going to terminal tab and pressing the recycle bin or <kbd>CTRL + C</kbd> and then start the extension again by pressing `F5`

### Formatting

This project uses [prettier](https://prettier.io/) for code formatting. You can run prettier across the code by calling `npm run prettier` from a terminal.

### Linting

This project uses [ESLint](https://eslint.org/) for code linting. You can run ESLint across the code by calling `npm run eslint` from a terminal.

### Testing

The repository contains https://github.com/testmycode/tmc-python-tester as a submodule, and it is required for running the integration tests. To initialize the submodule, run `git submodule init && git submodule update`.

The integration tests use a mock backend which needs to be initialised. Run `cd backend && npm run setup` to do so.

Integration tests can be ran with `npm run test`.

### Bundling

To generate a VSIX (installation package) run the following from a terminal:

```
vsce package
```

### Debugging

#### Using VSCode

1. Open the `tmc-vscode` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. In the Debug view, choose the `Run Extension` launch configuration from the launch dropdown and press `F5`.

## Submitting a Pull Request

Submit a pull request, and if it fixes problems that have an existing issues on GitHub, tag the issues in the body using "Resolves #issue_id" or "Fixes #issue_id".

## Releasing

To release, create a release with the tag in the format `vMAJOR.MINOR.PATCH`, for example `v1.2.3`. For a pre-release version, append `-prerelease` to the tag, for example `v1.2.3-prerelease`.

A script is ran during the release process to ensure that

- the `CHANGELOG.md` has an entry for the tagged version
- the `package.json` and `package-lock.json` has the same version number as the tagged version
