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
  - The backend URLs (TMC/mooc) are baked in at build time by the `BACKEND` env var, which picks one of the build profiles in `config.js`. `BACKEND=mockBackend` points both at the bundled mock on `localhost:4001`; `BACKEND=mockTmcLocalMooc` keeps TMC on the mock but sends mooc to a local `secret-project-331` cluster (`http://project-331.local`); anything else (including unset) falls back to `productionApi`. The profiles also pin `TMC_LANGS_RUST_VERSION`, i.e. which `tmc-langs-cli` release gets downloaded.
- The main intention behind the `UserData` and `WorkspaceManager` split is that the former mostly reflects user data on server while the latter manages local data on disk.
- Validation for persistent data is run at launch because new releases may not be backwards compatible.

## Two backends

The extension talks to two unrelated backends:

|        | legacy TMC                   | mooc                                          |
| ------ | ---------------------------- | --------------------------------------------- |
| Server | `tmc.mooc.fi` (`tmc-server`) | `courses.mooc.fi` (`secret-project-331`)      |
| API    | REST v8                      | `/api/v0/exercise-services/client`            |
| Ids    | integers                     | UUID strings                                  |
| Auth   | username/password grant      | OAuth2 device authorization (RFC 8628) bearer |

Both are supported at the same time; the user picks a platform when adding a
course, and a course carries its platform with it from then on.

### Everything goes through tmc-langs-cli

The extension makes no HTTP requests to either backend. `src/api/langs.ts`
(class `Langs`) spawns the `tmc-langs-cli` binary for every operation, one
one-shot process per call, and parses the JSON it writes to stdout. The only
HTTP the extension does itself is downloading that binary
(`downloadFile` in `src/utilities/utils.ts`).

Which backend a command hits is decided by the CLI's top-level subcommand, so
the argv builders in `Langs` are the split:

- `_tmcCmd(...)` → `tmc --client-name <name> --client-version <version> ...`
- `_moocCmd(...)` → `mooc --client-name <name> ...`
- `_settingsCmd(...)` → `settings --client-name <name> ...` (backend-agnostic)

The root URLs are passed to the child process in the environment:
`TMC_LANGS_TMC_ROOT_URL`, `TMC_LANGS_MOOC_ROOT_URL` and `TMC_LANGS_CONFIG_DIR`
(where the CLI keeps credentials). Each falls back to the build-profile value
(see below) if not already set in `process.env`, which is how the test tiers
point the CLI at a mock.

Most operations exist as a pair of methods (`checkTmcExerciseUpdates` /
`checkMoocExerciseUpdates`), with a dispatcher on top that branches on the
identifier's `kind`.

### The `Enum<Tmc, Mooc>` union

`shared/lib.ts` holds the abstraction the rest of the code is written against:

```ts
type Enum<Tmc, Mooc> = { kind: "tmc"; data: Tmc } | { kind: "mooc"; data: Mooc }
```

`match(value, onTmc, onMooc)` is the Rust-style exhaustive switch over it and is
the intended way to consume one; `makeTmcKind` / `makeMoocKind` construct one,
and `EnumSchema(tmcSchema, moocSchema)` is the zod equivalent for persisted or
webview-transported data. `matchBackend` does the same for the flatter
`{ backend: "tmc" | "mooc" }` shape used for CLI invocations.

Ids are modelled with it rather than as bare numbers/strings, because the two
backends disagree on both type and meaning:

- `CourseIdentifier` — tmc `{ courseId: number }`, mooc `{ instanceId: string }`
  (mooc has no separate course-instance concept, so this is the course UUID)
- `ExerciseIdentifier` — tmc `{ tmcExerciseId: number }`, mooc
  `{ moocExerciseId: string }`

New mooc functionality belongs beside its tmc counterpart behind these types.
Do not thread raw ids around.

### The CLI's stdout contract

`shared/langsSchema.ts` is a zod mirror of the CLI's JSON output. The schemas
under `shared/generated/langs/` are generated from `shared/bindings.schema.json`,
which is vendored from tmc-langs-rust — do not hand-edit either:

- `pnpm run vendor:langs-schema` re-vendors the JSON Schema from a sibling
  `../tmc-langs-rust` checkout
- `pnpm run generate:langs-schema` regenerates the zod/TS files from it

CI re-runs the generate step and diffs, so a stale generated file fails the
build. Because the mooc types originate in `secret-project-331`
(`exercise-services-api`), a backend type change has to travel all three repos:
backend crate → CLI → this file.

## Mock backends

`backend/` is one Express app on port 4001 (`pnpm run backend:start`) serving
both mocks:

- the legacy TMC v8 mock — routes in `backend/index.ts` and
  `backend/controllers/`, plus a `backend/cli/` directory the CLI download is
  served from
- the mooc mock — `backend/mooc/`, registered by `registerMoocRoutes`. Its
  resource endpoints are routed and validated by `openapi-backend` against the
  OpenAPI document vendored from `secret-project-331`
  (`backend/mooc/exercise-services-client.openapi.generated.json`,
  re-vendored with `pnpm run vendor:langs-openapi`): requests _and_ responses
  are validated, so a spec violation surfaces as a 500 instead of drifting
  silently. `backend/mooc/oauth.ts` mocks the device-flow endpoints under
  `/api/v0/main-frontend/oauth`, deliberately outside the validated router
  because they are not part of that spec.

The mooc mock has its own `node:test` suites (`backend/mooc/*.test.ts`), run
with `pnpm test` inside `backend/` and by the "Mooc mock backend tests" CI job.
They are what keeps the mock honest against the vendored spec, so run them after
touching anything under `backend/mooc/`.

The integration and Playwright tiers point the CLI at this mock with
`TMC_LANGS_MOOC_ROOT_URL=http://localhost:4001`. Note that the CLI only attaches
a bearer token to trusted domains, so those tiers also set
`TMC_LANGS_MOOC_TRUST_LOCALHOST=1`; without it every authenticated mooc call
against localhost 401s.

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
