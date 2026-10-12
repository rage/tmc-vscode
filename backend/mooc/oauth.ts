import { randomUUID } from "crypto"

import type { Express, Request, Response } from "express"
import express from "express"

import {
  MOCK_INVALID_REFRESH_TOKEN,
  MOCK_SEEDED_ACCESS_TOKEN,
  MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN,
  MOCK_SEEDED_REFRESH_TOKEN,
  mockUserCode,
} from "../mockSession"
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

/** The scope the exercise-services resource API requires (sp331 EXERCISE_SERVICES_SCOPE). */
export const EXERCISE_SERVICES_SCOPE = "exercise-services"

// Client ids that select a non-default device-flow scenario; any other id
// gets the "approve" scenario.
export const MOCK_OAUTH_CLIENT_IDS = {
  deny: "mooc-mock-deny",
  expired: "mooc-mock-expired",
  never: "mooc-mock-never",
  slowDown: "mooc-mock-slowdown",
  // Answers `device_authorization` like the proxy in front of a backend being redeployed.
  unavailable: "mooc-mock-unavailable",
} as const

/**
 * tmc-mooc-client's `DEFAULT_CLIENT_ID` (crates/tmc-mooc-client/src/auth.rs);
 * overridable via `TMC_LANGS_MOOC_CLIENT_ID`.
 */
export const REAL_VSCODE_CLIENT_ID = "tmc-vscode"

/** client_ids both endpoints accept; anything else -> `invalid_client`. */
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

/**
 * One mock instance's device-flow + token state. Built by {@link createMoocOAuthState}
 * and owned by that instance alone -- two mocks in one process (the suites run several)
 * therefore mint, expire and reset tokens independently.
 */
export interface MoocOAuthState {
  deviceCodeState: Map<string, DeviceCodeState>
  /** Device authorizations issued since the last reset; numbers each user code. */
  deviceAuthorizations: number
  /** Tokens this instance has minted or seeded; consulted only when `requireAuth` is on. */
  issuedAccessTokens: Map<string, AccessTokenRecord>
  issuedRefreshTokens: Map<string, RefreshTokenRecord>
  /** Injectable clock (ms); tests override via setDeviceFlowClock for deterministic
   * progression without real sleeps or timer mocking. */
  now: () => number
  /** Clears device-flow + issued-token state and the injected clock, for test isolation. */
  reset: () => void
}

const SEEDED_FAMILY_ID = "seeded"

const seedWellKnownTokens = (state: MoocOAuthState): void => {
  state.issuedAccessTokens.set(MOCK_SEEDED_ACCESS_TOKEN, {
    scopes: [EXERCISE_SERVICES_SCOPE],
    expiresAt: Number.POSITIVE_INFINITY,
    familyId: SEEDED_FAMILY_ID,
  })
  state.issuedAccessTokens.set(MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN, {
    scopes: [],
    expiresAt: Number.POSITIVE_INFINITY,
  })
  state.issuedRefreshTokens.set(MOCK_SEEDED_REFRESH_TOKEN, {
    clientId: REAL_VSCODE_CLIENT_ID,
    scopes: [EXERCISE_SERVICES_SCOPE],
    familyId: SEEDED_FAMILY_ID,
    redeemed: false,
  })
}

/** Builds one mock instance's isolated OAuth device-flow + token state. */
export const createMoocOAuthState = (): MoocOAuthState => {
  const state: MoocOAuthState = {
    deviceCodeState: new Map(),
    deviceAuthorizations: 0,
    issuedAccessTokens: new Map(),
    issuedRefreshTokens: new Map(),
    now: () => Date.now(),
    reset: () => {
      state.deviceCodeState.clear()
      state.deviceAuthorizations = 0
      state.issuedAccessTokens.clear()
      state.issuedRefreshTokens.clear()
      seedWellKnownTokens(state)
      state.now = () => Date.now()
    },
  }
  seedWellKnownTokens(state)
  return state
}

/** Overrides `state`'s device-flow clock. Pass nothing to restore real wall time. */
export const setDeviceFlowClock = (state: MoocOAuthState, clock?: () => number): void => {
  state.now = clock ?? (() => Date.now())
}

/**
 * Scopes a bearer carries, or `undefined` if `state` doesn't recognise it or it
 * has expired (-> 401). A recognised token with a scope set lacking the required
 * scope is valid but insufficient (-> 403). Consulted by the auth-mode router in
 * router.ts.
 */
export const scopesForBearer = (state: MoocOAuthState, token: string): string[] | undefined => {
  const record = state.issuedAccessTokens.get(token)
  if (!record || state.now() >= record.expiresAt) {
    return undefined
  }
  return record.scopes
}

/**
 * Expires `token` in `state`, or every access token it currently honours when
 * given none, so a test can make the next resource call 401 without waiting out
 * a lifetime. Returns false only for a token `state` never issued.
 */
export const expireMoocAccessToken = (state: MoocOAuthState, token?: string): boolean => {
  if (token === undefined) {
    for (const record of state.issuedAccessTokens.values()) {
      record.expiresAt = state.now()
    }
    return true
  }
  const record = state.issuedAccessTokens.get(token)
  if (!record) {
    return false
  }
  record.expiresAt = state.now()
  return true
}

/** Drops every token of a rotation chain, as reuse detection requires. */
const revokeFamily = (state: MoocOAuthState, familyId: string): void => {
  for (const [token, record] of state.issuedAccessTokens) {
    if (record.familyId === familyId) {
      state.issuedAccessTokens.delete(token)
    }
  }
  for (const [token, record] of state.issuedRefreshTokens) {
    if (record.familyId === familyId) {
      state.issuedRefreshTokens.delete(token)
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
  state: MoocOAuthState,
  clientId: string,
  scopes: string[],
  familyId: string = randomUUID(),
): Record<string, unknown> => {
  const accessToken = `mock-access-${randomUUID()}`
  const refreshToken = `mock-refresh-${randomUUID()}`
  state.issuedAccessTokens.set(accessToken, {
    scopes,
    expiresAt: state.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000,
    familyId,
  })
  state.issuedRefreshTokens.set(refreshToken, { clientId, scopes, familyId, redeemed: false })
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

/**
 * Answers with an RFC 6749 / RFC 8628 error the way sp331 renders OAuthErrorData
 * (server/src/domain/error.rs): 401 plus a Bearer challenge for `invalid_client`,
 * 400 for everything else.
 */
const sendOAuthError = (res: Response, error: string): void => {
  const errorDescription = ERROR_DESCRIPTIONS[error] ?? error
  if (error === "invalid_client") {
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer error="${error}", error_description="${errorDescription}"`)
  } else {
    res.status(400)
  }
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache" })
  res.json({ error, error_description: errorDescription })
}

const formField = (req: Request, name: string): string => {
  const value = ((req.body ?? {}) as Record<string, unknown>)[name]
  return typeof value === "string" ? value : ""
}

const handleDeviceAuthorization = (
  state: MoocOAuthState,
  baseUrl: string,
  req: Request,
  res: Response,
): void => {
  const clientId = formField(req, "client_id")
  if (!ALLOWED_CLIENT_IDS.has(clientId)) {
    sendOAuthError(res, "invalid_client")
    return
  }
  const allowedScopes = CLIENT_SCOPES.get(clientId) ?? []
  const requestedScopes = formField(req, "scope").split(" ").filter(Boolean)
  if (requestedScopes.some((scope) => !allowedScopes.includes(scope))) {
    sendOAuthError(res, "invalid_scope")
    return
  }
  if (clientId === MOCK_OAUTH_CLIENT_IDS.unavailable) {
    res
      .status(503)
      .type("html")
      .send("<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>")
    return
  }
  const scenario = scenarioForClient(clientId)
  const deviceCode = `mock-device-${randomUUID()}`
  state.deviceAuthorizations += 1
  const userCode = mockUserCode(state.deviceAuthorizations)
  state.deviceCodeState.set(deviceCode, {
    scenario,
    clientId,
    scopes: requestedScopes.length > 0 ? requestedScopes : allowedScopes,
    issuedAt: state.now(),
    intervalSeconds: DEVICE_INTERVAL_SECONDS,
    expiresInSeconds: DEVICE_EXPIRES_IN_SECONDS,
  })
  res.status(200).json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${baseUrl}/oauth_device`,
    verification_uri_complete: `${baseUrl}/oauth_device?user_code=${userCode}`,
    expires_in: DEVICE_EXPIRES_IN_SECONDS,
    // Tests override this via TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS to stay fast.
    interval: DEVICE_INTERVAL_SECONDS,
  })
}

const handleDeviceGrant = (state: MoocOAuthState, req: Request, res: Response): void => {
  const deviceCode = formField(req, "device_code")
  const clientId = formField(req, "client_id")
  const deviceState = state.deviceCodeState.get(deviceCode)
  // Never issued, or already redeemed and therefore deleted: either way the
  // grant is gone, which RFC 6749 calls `invalid_grant`. `expired_token` is
  // reserved below for a code that is still on file but past its lifetime.
  if (!deviceState || deviceState.clientId !== clientId) {
    sendOAuthError(res, "invalid_grant")
    return
  }
  const { scenario, issuedAt, intervalSeconds, expiresInSeconds, lastPolledAt } = deviceState
  const polledAt = state.now()
  deviceState.lastPolledAt = polledAt
  const elapsedMs = polledAt - issuedAt
  const intervalMs = intervalSeconds * 1000

  // Terminal per-scenario errors, independent of elapsed time.
  if (scenario === "deny") {
    sendOAuthError(res, "access_denied")
    return
  }
  if (scenario === "expired") {
    sendOAuthError(res, "expired_token")
    return
  }

  // An old device code can't be redeemed forever: once its advertised
  // lifetime has elapsed, it's rejected regardless of scenario.
  if (elapsedMs >= expiresInSeconds * 1000) {
    sendOAuthError(res, "expired_token")
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
    state.deviceCodeState.delete(deviceCode)
    res.status(200).json(issueToken(state, deviceState.clientId, deviceState.scopes))
    return
  }
  if (scenario === "slowDown" && elapsedMs < intervalMs) {
    sendOAuthError(res, "slow_down")
    return
  }
  if (lastPolledAt !== undefined && polledAt - lastPolledAt < intervalMs) {
    sendOAuthError(res, "slow_down")
    return
  }
  sendOAuthError(res, "authorization_pending")
}

const handleRefreshGrant = (state: MoocOAuthState, req: Request, res: Response): void => {
  const refreshToken = formField(req, "refresh_token")
  const clientId = formField(req, "client_id")
  // A permanent `invalid_grant` for the sentinel, driving the langs
  // refresh-then-DELETE path.
  if (refreshToken === MOCK_INVALID_REFRESH_TOKEN) {
    sendOAuthError(res, "invalid_grant")
    return
  }
  const record = state.issuedRefreshTokens.get(refreshToken)
  if (!record || record.clientId !== clientId) {
    sendOAuthError(res, "invalid_grant")
    return
  }
  if (record.redeemed) {
    // Replaying a rotated token is the stolen-credential signal the OAuth 2.0
    // Security BCP exists for: the whole chain goes, not just this link.
    revokeFamily(state, record.familyId)
    sendOAuthError(res, "invalid_grant")
    return
  }
  record.redeemed = true
  res.status(200).json(issueToken(state, record.clientId, record.scopes, record.familyId))
}

const handleToken = (state: MoocOAuthState, req: Request, res: Response): void => {
  if (!ALLOWED_CLIENT_IDS.has(formField(req, "client_id"))) {
    sendOAuthError(res, "invalid_client")
    return
  }
  const grantType = formField(req, "grant_type")
  if (grantType === DEVICE_GRANT_TYPE) {
    handleDeviceGrant(state, req, res)
    return
  }
  if (grantType === "refresh_token") {
    handleRefreshGrant(state, req, res)
    return
  }
  sendOAuthError(res, "unsupported_grant_type")
}

/**
 * Mounts the mooc device-flow OAuth mock against `state`, so it shares no token
 * or device-code with any other instance registered in the same process.
 * `baseUrl` yields the address the mock is reachable at, read per request
 * because a standalone app only learns it once it binds; the verification
 * URIs advertised to the user are built from it. Parses urlencoded bodies
 * itself so it works whether or not the host app already registered a
 * urlencoded parser (body-parser skips re-parsing an already-parsed body).
 */
export const registerMoocOAuthRoutes = (
  app: Express,
  state: MoocOAuthState,
  baseUrl: () => string = () => DEFAULT_MOOC_MOCK_BASE_URL,
): void => {
  const form = express.urlencoded({ extended: false })
  app.post(`${OAUTH_BASE}/device_authorization`, form, (req, res) =>
    handleDeviceAuthorization(state, baseUrl(), req, res),
  )
  app.post(`${OAUTH_BASE}/token`, form, (req, res) => handleToken(state, req, res))
}
