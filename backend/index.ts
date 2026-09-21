import express from "express"

import { applicationRouter, langsRounter, oauthRouter, registerV8Routes } from "./controllers"
import { registerMoocRoutes } from "./mooc/router"

// Port + per-backend auth modes are env-overridable so a test can spawn a second
// mock instance with a different auth posture without disturbing this one. See
// src/test-integration/tmc_langs_cli.spec.ts (mooc bearer auth).
const PORT = Number(process.env.PORT ?? 4001)
const MOOC_REQUIRE_AUTH = process.env.MOOC_MOCK_REQUIRE_AUTH !== "0"
const TMC_REQUIRE_AUTH = process.env.TMC_MOCK_REQUIRE_AUTH !== "0"
// Lowest `X-Client-Version` the mooc mock serves. Unset by default, as on the
// host; a tier that wants to see a client turned away with 426 names one.
const MOOC_MINIMUM_CLIENT_VERSION = process.env.MOOC_MOCK_MINIMUM_CLIENT_VERSION
// operationId whose response should violate the spec, so a tier outside this
// process can watch the mock's own response validation turn it into a 500.
// One-off errors are armed per request via POST /mooc-mock/fail-next instead.
const MOOC_FAULT = process.env.MOOC_MOCK_FAULT
// Every absolute URL the mooc mock hands out is built from this, so it has to
// name the port this process actually listens on.
const MOOC_BASE_URL = process.env.MOOC_MOCK_BASE_URL ?? `http://localhost:${PORT}`

const app = express()
app.use((req, _res, next) => {
  const [url, params] = req.url.split("?")
  console.log(req.method, url, params ?? "")
  next()
})
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use("/langs", langsRounter)
app.use("/oauth", oauthRouter)
app.use("/api/v8/application", applicationRouter)

// courses.mooc.fi (`/api/v0/exercise-services/client`) mock, plus its
// spec-exempt `/mooc-archives` stub-download route. Same process/port as the
// legacy TMC mock -- the two API namespaces (/api/v8, /oauth vs
// /api/v0/exercise-services/client) do not collide.
registerMoocRoutes(app, {
  requireAuth: MOOC_REQUIRE_AUTH,
  baseUrl: MOOC_BASE_URL,
  minimumClientVersion: MOOC_MINIMUM_CLIENT_VERSION,
  injectResponseFault: MOOC_FAULT,
})

registerV8Routes(app, { requireAuth: TMC_REQUIRE_AUTH })

app.use((_req, res) => {
  console.log("Unknown endpoint")
  res.status(404).json({ error: "Unhandled endpoint" })
})

app.listen(PORT, () => {
  console.log("Server listening to", PORT)
})
