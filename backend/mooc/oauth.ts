import { randomUUID } from "crypto"

import type { Express, Request, Response } from "express"
import express from "express"

import { DEFAULT_MOOC_MOCK_BASE_URL } from "./fixtures"

// Mock of the courses.mooc.fi OAuth2 device-authorization endpoints
// (`/api/v0/main-frontend/oauth/*`, RFC 8628) backing the mooc device-flow login.
//
// These endpoints aren't part of the vendored exercise-services OpenAPI spec,
// so they're registered as plain Express routes, deliberately outside the
// spec-validated router in ./router.ts -- don't validate them against the spec.
//
// The flow is fixture-driven: `client_id` selects a scenario (approve, deny,
// expire, never, slow down), recorded alongside the device code it issues.
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
// credentials_mooc.json directly). Recognised without being minted via the OAuth
// endpoints, and exempt from the lifetime and single-use rules a minted token
// obeys, so a fixture can reuse one across tests:
//   - scoped access token        -> 200 (until expireMoocAccessToken names it)
//   - access token missing scope -> 403
//   - refresh token              -> a fresh pair, never consumed
//   - invalid refresh token      -> invalid_grant (exercises the langs
//     refresh-then-delete path)
export const MOCK_SEEDED_ACCESS_TOKEN = "mock-seeded-access-token"
export const MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN = "mock-seeded-noscope-access-token"
export const MOCK_SEEDED_REFRESH_TOKEN = "mock-seeded-refresh-token"
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

/**
 * Scopes each registered client may ask for. A request naming anything outside
 * its client's set is `invalid_scope`, so a client asking for a scope it was
 * never granted fails here rather than silently receiving a weaker token.
 */
const CLIENT_SCOPES = new Map<string, string[]>(
  [...ALLOWED_CLIENT_IDS].map((clientId) => [clientId, [EXERCISE_SERVICES_SCOPE]]),
)

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
  /** The only client that may redeem this code; any other gets `invalid_grant`. */
  clientId: string
  /** Scopes the eventual token carries, as granted at authorization time. */
  scopes: string[]
  /** ms timestamp (from the injectable clock) when the code was issued. */
  issuedAt: number
  /** advertised poll interval, in seconds; the approve transition derives from it. */
  intervalSeconds: number
  /** advertised lifetime, in seconds; the code is rejected once elapsed past it. */
  expiresInSeconds: number
  /** ms timestamp of the previous poll; polling again sooner earns `slow_down`. */
  lastPolledAt?: number
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
/** Advertised access-token lifetime (s), which the mock also enforces. */
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600

interface AccessTokenRecord {
  scopes: string[]
  /** ms timestamp past which the token is rejected; `Infinity` for a seeded one. */
  expiresAt: number
  /**
   * The rotation chain the token belongs to, or undefined for a seeded token.
   * Refresh-token reuse revokes every token sharing it.
   */
  familyId?: string
}

interface RefreshTokenRecord {
  clientId: string
  scopes: string[]
  familyId: string
  /** Redeeming a token already marked redeemed is reuse, and revokes the family. */
  redeemed: boolean
}

// Tokens the mock has minted or seeded; consulted by the auth-mode resource
// router only when `requireAuth` is on.
const issuedAccessTokens = new Map<string, AccessTokenRecord>()
const issuedRefreshTokens = new Map<string, RefreshTokenRecord>()

const seedWellKnownTokens = (): void => {
  issuedAccessTokens.set(MOCK_SEEDED_ACCESS_TOKEN, {
    scopes: [EXERCISE_SERVICES_SCOPE],
    expiresAt: Number.POSITIVE_INFINITY,
  })
  issuedAccessTokens.set(MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN, {
    scopes: [],
    expiresAt: Number.POSITIVE_INFINITY,
  })
}
seedWellKnownTokens()

/**
 * Scopes a bearer carries, or `undefined` if the mock doesn't recognise it or it
 * has expired (-> 401). A recognised token with a scope set lacking the required
 * scope is valid but insufficient (-> 403). Consulted by the auth-mode router in
 * router.ts.
 */
export const scopesForBearer = (token: string): string[] | undefined => {
  const record = issuedAccessTokens.get(token)
  if (!record || now() >= record.expiresAt) {
    return undefined
  }
  return record.scopes
}

/**
 * Expires `token`, or every access token the mock currently honours when given
 * none, so a test can make the next resource call 401 without waiting out a
 * lifetime. Returns false only for a token the mock never issued.
 */
export const expireMoocAccessToken = (token?: string): boolean => {
  if (token === undefined) {
    for (const record of issuedAccessTokens.values()) {
      record.expiresAt = now()
    }
    return true
  }
  const record = issuedAccessTokens.get(token)
  if (!record) {
    return false
  }
  record.expiresAt = now()
  return true
}

/** Clears in-memory device-flow + issued-token state (for test isolation). */
export const resetMoocOAuthState = (): void => {
  deviceCodeState.clear()
  issuedAccessTokens.clear()
  issuedRefreshTokens.clear()
  seedWellKnownTokens()
  // Drop any test-injected clock so a later run starts on real wall time.
  setDeviceFlowClock()
}

const deviceCodeFor = (scenario: Scenario): string => `mock-device-${scenario}`

/** Drops every token of a rotation chain, as reuse detection requires. */
const revokeFamily = (familyId: string): void => {
  for (const [token, record] of issuedAccessTokens) {
    if (record.familyId === familyId) {
      issuedAccessTokens.delete(token)
    }
  }
  for (const [token, record] of issuedRefreshTokens) {
    if (record.familyId === familyId) {
      issuedRefreshTokens.delete(token)
    }
  }
}

/**
 * A freshly minted OAuth2 token pair, byte-faithful to the real sp331 token
 * response (server/src/domain/oauth/token_response.rs): `token_type` is
 * `"Bearer"` and there is no `scope` field.
 *
 * `familyId` threads a refresh through the chain its device-code redemption
 * started, so reuse of any link revokes the whole chain.
 */
const issueToken = (
  clientId: string,
  scopes: string[],
  familyId: string = randomUUID(),
): Record<string, unknown> => {
  const accessToken = `mock-access-${randomUUID()}`
  const refreshToken = `mock-refresh-${randomUUID()}`
  issuedAccessTokens.set(accessToken, {
    scopes,
    expiresAt: now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000,
    familyId,
  })
  issuedRefreshTokens.set(refreshToken, { clientId, scopes, familyId, redeemed: false })
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
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
  invalid_scope: "The requested scope is not available to this client.",
  unsupported_grant_type: "The grant type is not supported.",
  invalid_client: "The client is not registered with the authorization server.",
}

/** An RFC 8628 / RFC 6749 error body (HTTP 400), mirroring sp331's OAuthErrorData. */
const oauthError = (error: string): Record<string, unknown> => ({
  error,
  error_description: ERROR_DESCRIPTIONS[error] ?? error,
})

const formField = (req: Request, name: string): string => {
  const value = ((req.body ?? {}) as Record<string, unknown>)[name]
  return typeof value === "string" ? value : ""
}

const handleDeviceAuthorization = (baseUrl: string, req: Request, res: Response): void => {
  const clientId = formField(req, "client_id")
  if (!ALLOWED_CLIENT_IDS.has(clientId)) {
    res.status(400).json(oauthError("invalid_client"))
    return
  }
  const allowedScopes = CLIENT_SCOPES.get(clientId) ?? []
  const requestedScopes = formField(req, "scope").split(" ").filter(Boolean)
  if (requestedScopes.some((scope) => !allowedScopes.includes(scope))) {
    res.status(400).json(oauthError("invalid_scope"))
    return
  }
  const scenario = scenarioForClient(clientId)
  const deviceCode = deviceCodeFor(scenario)
  deviceCodeState.set(deviceCode, {
    scenario,
    clientId,
    scopes: requestedScopes.length > 0 ? requestedScopes : allowedScopes,
    issuedAt: now(),
    intervalSeconds: DEVICE_INTERVAL_SECONDS,
    expiresInSeconds: DEVICE_EXPIRES_IN_SECONDS,
  })
  res.status(200).json({
    device_code: deviceCode,
    user_code: MOCK_USER_CODE,
    verification_uri: `${baseUrl}/oauth_device`,
    verification_uri_complete: `${baseUrl}/oauth_device?user_code=${MOCK_USER_CODE}`,
    expires_in: DEVICE_EXPIRES_IN_SECONDS,
    // Tests override this via TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS to stay fast.
    interval: DEVICE_INTERVAL_SECONDS,
  })
}

const handleDeviceGrant = (req: Request, res: Response): void => {
  const deviceCode = formField(req, "device_code")
  const clientId = formField(req, "client_id")
  const state = deviceCodeState.get(deviceCode)
  // Never issued, or already redeemed and therefore deleted: either way the
  // grant is gone, which RFC 6749 calls `invalid_grant`. `expired_token` is
  // reserved below for a code that is still on file but past its lifetime.
  if (!state || state.clientId !== clientId) {
    res.status(400).json(oauthError("invalid_grant"))
    return
  }
  const { scenario, issuedAt, intervalSeconds, expiresInSeconds, lastPolledAt } = state
  const polledAt = now()
  state.lastPolledAt = polledAt
  const elapsedMs = polledAt - issuedAt
  const intervalMs = intervalSeconds * 1000

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
  if (elapsedMs >= expiresInSeconds * 1000) {
    res.status(400).json(oauthError("expired_token"))
    return
  }

  // Completion is wall-clock based (elapsed vs the advertised interval), not a
  // poll counter, since the CLI waits ~`interval` between polls. The slowDown
  // scenario takes two intervals so its first interval is a deterministic
  // `slow_down` on the very first poll, which no poll rate can produce.
  const intervalsToApprove = scenario === "slowDown" ? 2 : 1
  if (scenario !== "never" && elapsedMs >= intervalsToApprove * intervalMs) {
    // Approval outranks the poll-rate rule below: once the user has authorized,
    // a client that polled too eagerly still gets its token.
    deviceCodeState.delete(deviceCode)
    res.status(200).json(issueToken(state.clientId, state.scopes))
    return
  }
  if (scenario === "slowDown" && elapsedMs < intervalMs) {
    res.status(400).json(oauthError("slow_down"))
    return
  }
  if (lastPolledAt !== undefined && polledAt - lastPolledAt < intervalMs) {
    res.status(400).json(oauthError("slow_down"))
    return
  }
  res.status(400).json(oauthError("authorization_pending"))
}

const handleRefreshGrant = (req: Request, res: Response): void => {
  const refreshToken = formField(req, "refresh_token")
  const clientId = formField(req, "client_id")
  // A permanent `invalid_grant` for the sentinel, driving the langs
  // refresh-then-DELETE path.
  if (refreshToken === MOCK_INVALID_REFRESH_TOKEN) {
    res.status(400).json(oauthError("invalid_grant"))
    return
  }
  if (refreshToken === MOCK_SEEDED_REFRESH_TOKEN) {
    res.status(200).json(issueToken(clientId, CLIENT_SCOPES.get(clientId) ?? []))
    return
  }
  const record = issuedRefreshTokens.get(refreshToken)
  if (!record || record.clientId !== clientId) {
    res.status(400).json(oauthError("invalid_grant"))
    return
  }
  if (record.redeemed) {
    // Replaying a rotated token is the stolen-credential signal the OAuth 2.0
    // Security BCP exists for: the whole chain goes, not just this link.
    revokeFamily(record.familyId)
    res.status(400).json(oauthError("invalid_grant"))
    return
  }
  record.redeemed = true
  res.status(200).json(issueToken(record.clientId, record.scopes, record.familyId))
}

const handleToken = (req: Request, res: Response): void => {
  const grantType = formField(req, "grant_type")
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
 * Mounts the mooc device-flow OAuth mock. `baseUrl` yields the address the mock
 * is reachable at, read per request because a standalone app only learns it once
 * it binds; the verification URIs advertised to the user are built from it.
 * Parses urlencoded bodies itself so it works whether or not the host app
 * already registered a urlencoded parser (body-parser skips re-parsing an
 * already-parsed body).
 */
export const registerMoocOAuthRoutes = (
  app: Express,
  baseUrl: () => string = () => DEFAULT_MOOC_MOCK_BASE_URL,
): void => {
  const form = express.urlencoded({ extended: false })
  app.post(`${OAUTH_BASE}/device_authorization`, form, (req, res) =>
    handleDeviceAuthorization(baseUrl(), req, res),
  )
  app.post(`${OAUTH_BASE}/token`, form, handleToken)
}
