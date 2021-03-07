# Setting up development environment

You need the following installed on your computer:
- Visual Studio Code
- Node.js / npm

Setup the environment:

1. Download / git clone the repo
2. Go to root of the repository using terminal
3. Run: ```npm ci```
4. Run: ```code .```
5. Done

## Quick start

* From VSCode, the extension can be launched with `F5` by default
* Code execution starts from `src/extension.ts`
* Contributions such as new commands are defined in `package.json`
* Automatic build task starts the first time that the extension is launched from VSCode
  * Editing only type definitions doesn't seem to trigger a new build
* There are separate webpack configurations for development and production
  * When API data is casted to a type at runtime, "extra" fields are only allowed in production builds. Hence, if API is expanded, the corresponding API type definitions must be fixed by then.
* The main intention behind the `UserData` and `WorkspaceManager` split is that the former mostly reflects user data on server while the latter manages local data on disk.
* Validation for persistent data is run at launch because new releases may not be backwards compatible.

## Third party resources

* [TMC API](http://testmycode.github.io/tmc-server/)
* [TMC Langs](https://github.com/rage/tmc-langs-rust)
* [VSCode API Documentation](https://code.visualstudio.com/api/references/commands)
