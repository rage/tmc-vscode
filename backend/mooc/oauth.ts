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
// `client_id` selects a scenario (approve, deny, expire, never, slow down).
// Approval and expiry follow elapsed time on an injectable clock
// (`setDeviceFlowClock`), not a poll counter, so tests need no real sleeps.

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

/** Scopes each client may ask for; anything outside the set is `invalid_scope`. */
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

/** Per-device-code state; the token endpoint derives approval and expiry from it. */
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

/** One mock instance's device-flow and token state; mocks in one process share nothing. */
export interface MoocOAuthState {
  deviceCodeState: Map<string, DeviceCodeState>
  /** Device authorizations issued since the last reset; numbers each user code. */
  deviceAuthorizations: number
  /** Tokens this instance has minted or seeded; consulted only when `requireAuth` is on. */
  issuedAccessTokens: Map<string, AccessTokenRecord>
  issuedRefreshTokens: Map<string, RefreshTokenRecord>
  /** Injectable clock (ms); override via {@link setDeviceFlowClock}. */
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
 * Scopes a bearer carries, or `undefined` if unknown or expired (-> 401). A known
 * token lacking the required scope is valid but insufficient (-> 403). Used by
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
 * Expires `token`, or every access token when given none, so the next resource
 * call 401s. Returns false only for a token `state` never issued.
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
 * Mints a token pair shaped like sp331's token response
 * (server/src/domain/oauth/token_response.rs): `token_type` is `"Bearer"`, no
 * `scope` field. `familyId` carries a refresh along its rotation chain.
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

/** Renders an OAuth error like sp331's OAuthErrorData (server/src/domain/error.rs). */
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
    // Tests shorten it via TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS.
    interval: DEVICE_INTERVAL_SECONDS,
  })
}

const handleDeviceGrant = (state: MoocOAuthState, req: Request, res: Response): void => {
  const deviceCode = formField(req, "device_code")
  const clientId = formField(req, "client_id")
  const deviceState = state.deviceCodeState.get(deviceCode)
  // Unknown or already redeemed (deleted); `expired_token` is only for codes still on file.
  if (!deviceState || deviceState.clientId !== clientId) {
    sendOAuthError(res, "invalid_grant")
    return
  }
  const { scenario, issuedAt, intervalSeconds, expiresInSeconds, lastPolledAt } = deviceState
  const polledAt = state.now()
  deviceState.lastPolledAt = polledAt
  const elapsedMs = polledAt - issuedAt
  const intervalMs = intervalSeconds * 1000

  if (scenario === "deny") {
    sendOAuthError(res, "access_denied")
    return
  }
  if (scenario === "expired") {
    sendOAuthError(res, "expired_token")
    return
  }

  if (elapsedMs >= expiresInSeconds * 1000) {
    sendOAuthError(res, "expired_token")
    return
  }

  // slowDown takes two intervals so its first poll deterministically gets `slow_down`.
  const intervalsToApprove = scenario === "slowDown" ? 2 : 1
  if (scenario !== "never" && elapsedMs >= intervalsToApprove * intervalMs) {
    // Approval outranks the poll-rate rule below.
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
  // Drives langs' refresh-then-delete path.
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
    // Replay of a rotated token signals theft: revoke the whole chain.
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
 * Mounts the device-flow OAuth mock against `state`. `baseUrl` is read per request
 * (a standalone app learns its address only once bound) to build verification URIs.
 * Parses urlencoded bodies itself, so it works with or without a host-level parser.
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
