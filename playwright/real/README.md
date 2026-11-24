# Real-backend E2E (opt-in)

Drives the real extension in VS Code against a real courses.mooc.fi stack, `project-331.local`
(secret-project-331 on minikube + skaffold). Nothing in the default Playwright run, CI or
`pnpm test` includes it: it needs `TMC_E2E_REAL=1`.

## Run

1. Build the extension for the local stack: `BACKEND=mockTmcLocalMooc pnpm run build` (the
   profile points the extension's mooc backend at `http://project-331.local`; the CLI also needs
   `TMC_LANGS_MOOC_TRUST_LOCALHOST=1`, which the harness sets).
2. Add the test course exercises to the stack, additively: `playwright/real/scripts/setup-course.sh`
   (needs `python3`, `curl`; writes `scripts/ids.env`). It never reseeds. Never run a reseed or
   redeploy against a stack other people use, and never point this at production.
3. Run with a student no other run is using, since sp331 revokes a whole refresh-token family when
   a refresh token is reused: `E2E_STUDENT=student1 pnpm run test:real playwright/real/smoke.real.ts`.

Other settings: `E2E_MOOC_ROOT_URL` (another stack), `E2E_OUT` (screenshots and run state),
`E2E_CLI` (a CLI binary other than `backend/cli`'s), `KEEP_RUN=1` (continue a previous spec's profile).

## Specs

| Spec | Covers |
| --- | --- |
| `smoke.real.ts` | device login, add course, download, run tests |
| `loop.real.ts` | the whole student loop: submit, fix, old submission, paste, reset |
| `history.real.ts` | submission history and restoring |
| `tries.real.ts`, `out-of-tries.real.ts` | try limits and being out of tries |
| `grading.real.ts` | grading outcomes the backend returns |

Not ported from the author's scratch set: AI policy and chapter scenarios, which need teacher
fixtures (`teacher.py`, per-scenario page setup) that are not in the repo yet. These specs are
exempt from lint and format (`playwright/real` in `.oxlintrc.json`) because they were written as a
scratch harness; they are type-checked.
