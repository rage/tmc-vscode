# Contributing

## Where to begin?

You can start by looking through the issues marked with label [`good first issue`](https://github.com/rage/tmc-vscode/labels/good%20first%20issue).

## Setup

### Prerequisites

-   [Git](https://git-scm.com/)
-   [NodeJS / npm](https://nodejs.org/)
-   [VSCode](https://code.visualstudio.com/)
-   [vsce](https://www.npmjs.com/package/vsce)
-   Chromium based browser for Playwright (`npx playwright install chromium`)

### Getting the code

```bash
git clone https://github.com/rage/tmc-vscode.git
```

### Preparing the repository

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```bash
npm ci
```

Repeat the same for the testing backend:

```bash
cd backend && npm ci && npm run setup
```

You will need to rerun the setup when langs is updated, as this step will download the appropriate version of the CLI for the integration tests.

Update the `tmc-python-tester` submodule

```bash
git submodule init && git submodule update
```

## Formatting

This project uses [prettier](https://prettier.io/) for code formatting. You can run prettier across the code by calling `npm run prettier` from a terminal.

## Linting

This project uses [ESLint](https://eslint.org/) for code linting. You can run ESLint across the code by calling `npm run eslint` from a terminal.

## Developing the extension

From VSCode, the extension can be launched with `F5` by default.
Automatic build task starts the first time that the extension is launched from VSCode.

You can also build the extension by running `npm run webpack` or `npm run webpack:watch`.

**NOTE!** If editing type definitions

You need to kill the webpackBuild task by going to terminal tab and pressing the recycle bin or <kbd>CTRL + C</kbd> and then start the extension again by pressing `F5`

**NOTE!** Running multiple instances of VSCode can interfere with this process. If you experience strange behaviour when running the extension, make sure there are no other instances of VSCode running.

## Testing

### Unit tests

#### Integration

The integration tests use a mock backend which needs to be initialised. Run `cd backend && npm run setup` to do so. The integration tests can be run with `npm run test`. If you get a `Connection error: TypeError`, make sure the backend is running.

#### Playwright

1. `npm run webpack:watch` to keep building the extension while writing code while VSCode is closed.

2. `npm run backend:start` to start the mock backend used by the tests.

3. `npm run playwright-test` to run the tests, `npm run playwright-test-debug` to debug the tests.

Playwright integration tests can be written in the `./playwright` directory.

The Playwright tests start a new instance of VSCode, meaning if you have VSCode open already the tests will fail due to multiple instances of VSCode. For this reason it's best to use another editor when working on the Playwright tests.

You can set the environment variable `PW_TEST_REPORT_OPEN` to `never` to prevent constantly opening the HTML test report when working on the tests.

## Bundling

To generate a VSIX (installation package) run the following from a terminal:

```
vsce package
```

## Submitting a Pull Request

Submit a pull request, and if it fixes problems that have an existing issues on GitHub, tag the issues in the body using "Resolves #issue_id" or "Fixes #issue_id".

## Releasing

To release, create a release with the tag in the format `vMAJOR.MINOR.PATCH`, for example `v1.2.3`. For a pre-release version, append `-prerelease` to the tag, for example `v1.2.3-prerelease`.

A script is ran during the release process to ensure that

- the `CHANGELOG.md` has an entry for the tagged version
- the `package.json` and `package-lock.json` has the same version number as the tagged version

You can update the `package-lock.json` version with `npm i --package-lock-only`.
