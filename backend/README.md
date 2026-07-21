Mock backends for testing. One Express app (`index.ts`, port 4001) hosts both:

- **Legacy TMC mock** (`tmc.mooc.fi`, REST API v8) — the original hand-written
  mock the extension has always tested against. Start it with
  `pnpm run backend:start`; point langs at it with `TMC_LANGS_TMC_ROOT_URL`.

- **Mooc mock** (`courses.mooc.fi`, the `/api/v0/exercise-services/client` API) —
  under `mooc/`, mounted by `registerMoocRoutes`. Point langs at it with
  `TMC_LANGS_MOOC_ROOT_URL`.

## Mooc mock (`backend/mooc`)

Spec-validated mock of the `courses.mooc.fi` exercise-services client API.
`openapi-backend` routes requests by `operationId` from the vendored OpenAPI
document and validates every request AND response against it — a response the
spec forbids becomes a loud HTTP 500, so the mock provably cannot drift from the
contract (a drift is a failing test). Highlights:

- `exercise-services-client.openapi.generated.json` — the OpenAPI spec, vendored
  from `secret-project-331` (where it is emitted from the exercise-services
  client handlers). Re-vendor and drift-check with `pnpm run vendor:langs-openapi`
  (local-only; needs the sibling `../secret-project-331` checkout).
- `fixtures.ts` — fixed-UUID courses/exercises across two courses (so the bulk
  download resolves exercise → course by scanning enrolled courses' slides, as
  the CLI does). `public_spec` is a valid editor spec the CLI can deserialise;
  `public-spec.schema.json` guards its shape out of band from the (opaque) wire
  spec.
- Stateful submit → grading poll and the old-submission list/download/share
  endpoints (mirroring the backend's two submission id spaces: submit returns an
  exercise-task-submission id for grading; list/download/share use
  exercise-slide-submission ids). `.tar.zst` exercise archives are served on the
  spec-exempt `/mooc-archives/*` route (the real `stub_download_url` is an
  arbitrary file-store URL).
- No auth: the CLI sends no bearer token to localhost (untrusted domain).

`conformance.test.ts` (run with `pnpm --filter tmc-vscode-mock-backend run test`)
exercises the routing, the request/response validation, the archive route, and a
fault-injection case proving the response-validation guard fails loudly.

## Testing the mooc path end to end

The mooc subcommands are newer than the released CLI, so build the CLI locally
first (see `docs/development.md` → "Using a locally-built tmc-langs CLI"):

```
bin/useLocalLangs.bash        # builds ../tmc-langs-rust into backend/cli
```

- **Integration** (`src/test-integration/tmc_langs_cli.spec.ts`): drives the local
  CLI straight at this mock; the mooc cases are gated behind the CLI version so
  CI's released CLI skips them. `pnpm run test:integration`.
- **Playwright E2E** (`playwright/tests/add-new-mooc-course.spec.ts`): both mock
  backends run in this one process (`pnpm run backend:start`), and
  `playwright/fixtures.ts` sets `TMC_LANGS_MOOC_ROOT_URL` at it. Run with
  `pnpm run playwright-test:local`.
