# Setting up development environment

You need the following installed on your computer:

- Visual Studio Code
- Node.js / [pnpm](https://pnpm.io/)

Setup the environment:

1. Download / git clone the repo
2. Go to root of the repository using terminal
3. Run: `pnpm install --frozen-lockfile`
4. Run: `code .`
5. Done

## Quick start

- From VSCode, the extension can be launched with `F5` by default
- Code execution starts from `src/extension.ts`
- Contributions such as new commands are defined in `package.json`
- Automatic build task starts the first time that the extension is launched from VSCode
  - Editing only type definitions doesn't seem to trigger a new build
- The extension host is bundled by a single esbuild config (`esbuild.mjs`); `NODE_ENV=production` only affects minification/sourcemaps
  - The backend URLs (TMC/mooc) are selected separately via the `BACKEND` env var, which picks one of the build profiles in `config.js` (`mockTmcLocalMooc`, `mockBackend`, `productionApi`)
- The main intention behind the `UserData` and `WorkspaceManager` split is that the former mostly reflects user data on server while the latter manages local data on disk.
- Validation for persistent data is run at launch because new releases may not be backwards compatible.

## Using a locally-built tmc-langs CLI

By default the dev/test flow downloads the released `tmc-langs-cli` pinned in
`config.js` (`TMC_LANGS_RUST_VERSION`). To test against the current
`tmc-langs-rust` migration branch instead, build and install it locally:

```
bin/useLocalLangs.bash
```

This expects a sibling `../tmc-langs-rust` checkout (override with
`TMC_LANGS_RUST_DIR`). It builds `tmc-langs-cli` in release mode and installs it
into `backend/cli` under the pinned filename with a regenerated `.sha256`, so
both the integration tier and Playwright pick it up transparently. The binary
still reports its real version (`--version`), which the integration suite uses
to decide whether to run the migration-contract tests; against the released CLI
those skip gracefully. `backend/cli` is gitignored — the local build is never
committed.

- Integration: `pnpm run test:integration`
- Playwright (needs the mock backend running, `pnpm run backend:start`):
  `pnpm run playwright-test:local` (builds with the `mockBackend` profile)

To restore the released CLI: `rm -rf backend/cli && (cd backend && pnpm run setup)`.

## Third party resources

- [TMC API](http://testmycode.github.io/tmc-server/)
- [TMC Langs](https://github.com/rage/tmc-langs-rust)
- [VSCode API Documentation](https://code.visualstudio.com/api/references/commands)
