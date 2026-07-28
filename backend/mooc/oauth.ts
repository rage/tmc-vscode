import { randomUUID } from "crypto"

import type { Express, Request, Response } from "express"
import express from "express"

import { MOOC_MOCK_BASE_URL } from "./fixtures"

// Mock of the courses.mooc.fi OAuth2 device-authorization endpoints
// (`/api/v0/main-frontend/oauth/*`, RFC 8628) backing the mooc device-flow login.
//
// These endpoints aren't part of the vendored exercise-services OpenAPI spec,
// so they're registered as plain Express routes, deliberately outside the
// spec-validated router in ./router.ts -- don't validate them against the spec.
//
// The flow is fixture-driven: `client_id` selects a scenario (approve, deny,
// expire, never, slow down), encoded into the device code so the token
// endpoint needs no separate lookup for it.
//
// Progression (pending -> approved) and expiry are decided by elapsed
// wall-clock time via an injectable clock (`setDeviceFlowClock`), not a poll
// counter, so tests can drive it deterministically without real sleeps.

const OAUTH_BASE = "/api/v0/main-frontend/oauth"

/** RFC 8628 device-code grant type URN. */
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

/** Deterministic user code shown to the user (asserted on in tests). */
export const MOCK_USER_CODE = "WXYZ-1234"

/** The scope the exercise-services resource API requires (sp331 EXERCISE_SERVICES_SCOPE). */
export const EXERCISE_SERVICES_SCOPE = "exercise-services"

// Well-known seeded tokens for tests that skip the device flow (e.g. writing
// credentials_mooc.json directly). Recognised by the auth-mode router
// (router.ts) without being minted via the OAuth endpoints:
//   - scoped access token        -> 200
//   - access token missing scope -> 403
//   - refresh token              -> invalid_grant (exercises the langs
//     refresh-then-delete path)
export const MOCK_SEEDED_ACCESS_TOKEN = "mock-seeded-access-token"
export const MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN = "mock-seeded-noscope-access-token"
export const MOCK_INVALID_REFRESH_TOKEN = "mock-invalid-refresh-token"

// Client ids that select a non-default device-flow scenario; any other id
// gets the "approve" scenario.
export const MOCK_OAUTH_CLIENT_IDS = {
  deny: "mooc-mock-deny",
  expired: "mooc-mock-expired",
  never: "mooc-mock-never",
  slowDown: "mooc-mock-slowdown",
} as const

/**
 * tmc-mooc-client's `DEFAULT_CLIENT_ID` (crates/tmc-mooc-client/src/auth.rs);
 * overridable via `TMC_LANGS_MOOC_CLIENT_ID`.
 */
export const REAL_VSCODE_CLIENT_ID = "tmc-vscode"

/** client_ids `device_authorization` accepts; anything else -> `invalid_client`. */
const ALLOWED_CLIENT_IDS = new Set<string>([
  REAL_VSCODE_CLIENT_ID,
  ...Object.values(MOCK_OAUTH_CLIENT_IDS),
])

type Scenario = "approve" | "deny" | "expired" | "never" | "slowDown"

const scenarioForClient = (clientId: string): Scenario => {
  switch (clientId) {
    case MOCK_OAUTH_CLIENT_IDS.deny:
      return "deny"
    case MOCK_OAUTH_CLIENT_IDS.expired:
      return "expired"
    case MOCK_OAUTH_CLIENT_IDS.never:
      return "never"
    case MOCK_OAUTH_CLIENT_IDS.slowDown:
      return "slowDown"
    default:
      return "approve"
  }
}

/**
 * Per-issued-device-code state, so the token endpoint can decide the
 * pending -> approved transition AND expiry from elapsed wall-clock time.
 */
interface DeviceCodeState {
  scenario: Scenario
  /** ms timestamp (from the injectable clock) when the code was issued. */
  issuedAt: number
  /** advertised poll interval, in seconds; the approve transition derives from it. */
  intervalSeconds: number
  /** advertised lifetime, in seconds; the code is rejected once elapsed past it. */
  expiresInSeconds: number
}
const deviceCodeState = new Map<string, DeviceCodeState>()

// Injectable clock (ms); tests override via setDeviceFlowClock for
// deterministic progression without real sleeps or timer mocking.
let now: () => number = () => Date.now()

/** Overrides the device-flow clock. Pass nothing to restore real wall time. */
export const setDeviceFlowClock = (clock?: () => number): void => {
  now = clock ?? (() => Date.now())
}

/** Advertised poll interval (s); matches the real server's 5s default. */
const DEVICE_INTERVAL_SECONDS = 5
/** Advertised device-code lifetime (s). */
const DEVICE_EXPIRES_IN_SECONDS = 900

// Access tokens the mock has minted, mapped to their scopes; consulted by the
// auth-mode resource router only when `requireAuth` is on.
const issuedAccessTokens = new Map<string, string[]>()

const recordIssuedToken = (accessToken: string, scopes: string[]): void => {
  issuedAccessTokens.set(accessToken, scopes)
}

/**
 * Scopes a bearer carries, or `undefined` if the mock doesn't recognise it
 * (-> 401). A recognised token with a scope set lacking the required scope is
 * valid but insufficient (-> 403). Consulted by the auth-mode router in router.ts.
 */
export const scopesForBearer = (token: string): string[] | undefined => {
  if (token === MOCK_SEEDED_ACCESS_TOKEN) {
    return [EXERCISE_SERVICES_SCOPE]
  }
  if (token === MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN) {
    return []
  }
  return issuedAccessTokens.get(token)
}

/** Clears in-memory device-flow + issued-token state (for test isolation). */
export const resetMoocOAuthState = (): void => {
  deviceCodeState.clear()
  issuedAccessTokens.clear()
  // Drop any test-injected clock so a later run starts on real wall time.
  setDeviceFlowClock()
}

const deviceCodeFor = (scenario: Scenario): string => `mock-device-${scenario}`

/**
 * A freshly minted OAuth2 token pair, byte-faithful to the real sp331 token
 * response (server/src/domain/oauth/token_response.rs): `token_type` is
 * `"Bearer"` and there is no `scope` field.
 */
const issueToken = (scopes: string[] = [EXERCISE_SERVICES_SCOPE]): Record<string, unknown> => {
  const accessToken = `mock-access-${randomUUID()}`
  recordIssuedToken(accessToken, scopes)
  return {
    access_token: accessToken,
    refresh_token: `mock-refresh-${randomUUID()}`,
    token_type: "Bearer",
    expires_in: 3600,
  }
}

// Human-readable descriptions for the RFC 6749 / RFC 8628 error codes the mock
// emits, mirroring the real server's OAuthErrorData.
const ERROR_DESCRIPTIONS: Record<string, string> = {
  authorization_pending: "The authorization request is still pending.",
  slow_down: "Polling too frequently; slow down.",
  access_denied: "The user denied the authorization request.",
  expired_token: "The device code has expired.",
  invalid_grant: "The provided grant is invalid, expired, or revoked.",
  unsupported_grant_type: "The grant type is not supported.",
  invalid_client: "The client is not registered with the authorization server.",
}

/** An RFC 8628 / RFC 6749 error body (HTTP 400), mirroring sp331's OAuthErrorData. */
const oauthError = (error: string): Record<string, unknown> => ({
  error,
  error_description: ERROR_DESCRIPTIONS[error] ?? error,
})

const handleDeviceAuthorization = (req: Request, res: Response): void => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const clientId = typeof body.client_id === "string" ? body.client_id : ""
  if (!ALLOWED_CLIENT_IDS.has(clientId)) {
    res.status(400).json(oauthError("invalid_client"))
    return
  }
  const scenario = scenarioForClient(clientId)
  const deviceCode = deviceCodeFor(scenario)
  deviceCodeState.set(deviceCode, {
    scenario,
    issuedAt: now(),
    intervalSeconds: DEVICE_INTERVAL_SECONDS,
    expiresInSeconds: DEVICE_EXPIRES_IN_SECONDS,
  })
  res.status(200).json({
    device_code: deviceCode,
    user_code: MOCK_USER_CODE,
    verification_uri: `${MOOC_MOCK_BASE_URL}/oauth_device`,
    verification_uri_complete: `${MOOC_MOCK_BASE_URL}/oauth_device?user_code=${MOCK_USER_CODE}`,
    expires_in: DEVICE_EXPIRES_IN_SECONDS,
    // Tests override this via TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS to stay fast.
    interval: DEVICE_INTERVAL_SECONDS,
  })
}

const handleDeviceGrant = (req: Request, res: Response): void => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const deviceCode = typeof body.device_code === "string" ? body.device_code : ""
  const state = deviceCodeState.get(deviceCode)
  if (!state) {
    // Unknown/never-issued device code: RFC 8628 terminal expired_token.
    res.status(400).json(oauthError("expired_token"))
    return
  }
  const { scenario, issuedAt, intervalSeconds, expiresInSeconds } = state
  const elapsedMs = now() - issuedAt
  const intervalMs = intervalSeconds * 1000
  const expiresMs = expiresInSeconds * 1000

  // Terminal per-scenario errors, independent of elapsed time.
  if (scenario === "deny") {
    res.status(400).json(oauthError("access_denied"))
    return
  }
  if (scenario === "expired") {
    res.status(400).json(oauthError("expired_token"))
    return
  }

  // An old device code can't be redeemed forever: once its advertised
  // lifetime has elapsed, it's rejected regardless of scenario.
  if (elapsedMs >= expiresMs) {
    res.status(400).json(oauthError("expired_token"))
    return
  }

  // Completion is wall-clock based (elapsed vs the advertised interval), not a
  // poll counter, since the CLI waits ~`interval` between polls.
  switch (scenario) {
    case "never":
      res.status(400).json(oauthError("authorization_pending"))
      return
    case "slowDown":
      // < 1 interval elapsed  -> slow_down (polled too soon)
      // < 2 intervals elapsed -> authorization_pending
      // >= 2 intervals        -> approved
      if (elapsedMs < intervalMs) {
        res.status(400).json(oauthError("slow_down"))
        return
      }
      if (elapsedMs < 2 * intervalMs) {
        res.status(400).json(oauthError("authorization_pending"))
        return
      }
      res.status(200).json(issueToken())
      return
    case "approve":
      // < 1 interval elapsed -> authorization_pending; >= 1 interval -> approved
      if (elapsedMs < intervalMs) {
        res.status(400).json(oauthError("authorization_pending"))
        return
      }
      res.status(200).json(issueToken())
  }
}

const handleRefreshGrant = (req: Request, res: Response): void => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : ""
  // A missing or sentinel refresh token is a permanent `invalid_grant`,
  // driving the langs refresh-then-DELETE path.
  if (refreshToken.length === 0 || refreshToken === MOCK_INVALID_REFRESH_TOKEN) {
    res.status(400).json(oauthError("invalid_grant"))
    return
  }
  res.status(200).json(issueToken())
}

const handleToken = (req: Request, res: Response): void => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const grantType = typeof body.grant_type === "string" ? body.grant_type : ""
  if (grantType === DEVICE_GRANT_TYPE) {
    handleDeviceGrant(req, res)
    return
  }
  if (grantType === "refresh_token") {
    handleRefreshGrant(req, res)
    return
  }
  res.status(400).json(oauthError("unsupported_grant_type"))
}

/**
 * Mounts the mooc device-flow OAuth mock. Parses urlencoded bodies itself so it
 * works whether or not the host app already registered a urlencoded parser
 * (body-parser skips re-parsing an already-parsed body).
 */
export const registerMoocOAuthRoutes = (app: Express): void => {
  const form = express.urlencoded({ extended: false })
  app.post(`${OAUTH_BASE}/device_authorization`, form, handleDeviceAuthorization)
  app.post(`${OAUTH_BASE}/token`, form, handleToken)
}
