# Contributing

## Where to begin?

You can start by looking through the issues marked with label [`good first issue`](https://github.com/rage/tmc-vscode/labels/good%20first%20issue).

## Project structure

- `./src`: contains the "backend" of the extension
  - `./src/actions`: Contains composable actions used by the VSCode commands and other actions
  - `./src/commands`: Contains a source file for each VSCode command contributed by the extension
- `./webview-ui`: contains the "frontend" of the extension
- `./shared`: contains types that are shared between the backend and frontend

## Setup

### Prerequisites

- [Git](https://git-scm.com/)
- [NodeJS](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [VSCode](https://code.visualstudio.com/)
- [vsce](https://www.npmjs.com/package/@vscode/vsce)
- Chromium based browser for Playwright (`pnpm dlx playwright install chromium`)

### Getting the code

```bash
git clone https://github.com/rage/tmc-vscode.git
```

### Preparing the repository

From a terminal, where you have cloned the repository, update the `tmc-python-tester` submodule

```bash
git submodule init && git submodule update
```

Then execute the following command to install the required dependencies:

```bash
pnpm run ci:all
```

Then prepare the backend:

```bash
cd backend && pnpm run setup
```

You will need to rerun the setup when langs is updated, as this step will download the appropriate version of the CLI for the integration tests.

### MOOC backend

To run the MOOC backend locally, see https://github.com/rage/secret-project-331.

## Formatting

This project uses [oxfmt](https://oxc.rs/) for code formatting. You can run oxfmt across the code by calling `pnpm run format` from a terminal, or check formatting without writing with `pnpm run format:check`.

## Linting

This project uses [oxlint](https://oxc.rs/) for code linting. You can run oxlint across the code by calling `pnpm run lint` from a terminal, or check linting without autofixing with `pnpm run lint:ci`.

## Developing the extension

From VSCode, the extension can be launched with `F5` by default.
Automatic build task starts the first time that the extension is launched from VSCode.

You can also build the extension by running `pnpm run build` or `pnpm run watch`.

## Updating dependencies

The tmc-langs version can be updated by changing the `TMC_LANGS_RUST_VERSION` variable in `config.js`.

## Testing

The tests use a mock backend which needs to be initialised. Run `cd backend && pnpm run setup` to do so. Unit and component tests (vitest) can be run with `pnpm run test`; the test-electron integration tier with `pnpm run test:integration`. If you get a `Connection error: TypeError`, make sure the backend is running.

1. `pnpm run watch` to keep building the extension while writing code while VSCode is closed.

2. `pnpm run backend:start` to start the mock backend used by the tests.

3. `pnpm run playwright-test` to run the tests, `pnpm run playwright-test-debug` to debug the tests.

Playwright integration tests can be written in the `./playwright` directory.

The Playwright tests start a new instance of VSCode, meaning if you have VSCode open already the tests will fail due to multiple instances of VSCode. For this reason it's best to use another editor when working on the Playwright tests.

You can set the environment variable `PW_TEST_REPORT_OPEN` to `never` to prevent constantly opening the HTML test report when working on the tests.

## Bundling

To generate a VSIX (installation package) run the following from a terminal:

```
vsce package --no-dependencies
```

The `--no-dependencies` flag is required: esbuild bundles all runtime dependencies into `dist/`, so `vsce` should not also try to walk pnpm's symlinked `node_modules` layout looking for production dependencies to include (see `./bin/package.bash`, which is the script CI actually runs).

## Submitting a Pull Request

Submit a pull request, and if it fixes problems that have an existing issues on GitHub, tag the issues in the body using "Resolves #issue_id" or "Fixes #issue_id".

## Releasing

To release, create a release with the tag in the format `vMAJOR.MINOR.PATCH`, for example `v1.2.3`. For a pre-release version, append `-prerelease` to the tag, for example `v1.2.3-prerelease`.

A script, `./bin/validateRelease.sh`, is ran during the release process to ensure that

- the `CHANGELOG.md` has an entry for the tagged version
- the Welcome panel changelog (`./webview-ui/src/panels/Welcome.svelte`) has an entry for the tagged version
- the `package.json` version matches the tagged version
- all configured tmc-langs builds referenced from `config.js` exist on the download server

You can run the script manually by giving the GitHub release tag you're going to use as an argument. For example `./bin/validateRelease.sh v3.0.0-prerelease`.

The extension is packaged using the script `./bin/package.bash`. Like the validation script, you should install and test the resulting package manually to ensure there's no problems with the packaging. (You can install the extension from the package by selecting `Extensions: Install from VSIX` from the command palette) (TODO: automatically test the actual package somehow?)

## Other notes

Running the extension produces the following superfluous warnings:

- `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.`: https://github.com/microsoft/vscode/issues/192853
- `[Violation] Avoid using document.write(). <URL>`: https://github.com/microsoft/vscode/issues/156147

Updating langs can be done by changing the version number at `config.js`.
