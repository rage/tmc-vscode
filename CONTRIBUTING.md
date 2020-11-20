# Contributing

## Where to begin?

You can start by looking through the issues marked with label [`good first issue`](https://github.com/rage/tmc-vscode/labels/good%20first%20issue).

### Getting the code

```
git clone https://github.com/rage/tmc-vscode.git
```

### Prerequisites

- [Git](https://git-scm.com/)
- [NodeJS / npm](https://nodejs.org/)
- [VSCode](https://code.visualstudio.com/)
- [vsce](https://www.npmjs.com/package/vsce)

### Dependencies

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```
npm ci
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

Submit a pull request and tag the issues in the body using "Resolves #id" or "Fixes #id".