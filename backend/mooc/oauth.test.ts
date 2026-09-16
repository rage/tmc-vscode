import assert from "node:assert/strict"
import type { Server } from "node:http"
import { after, afterEach, before, describe, test } from "node:test"

import type { Express } from "express"

import {
  DEVICE_GRANT_TYPE,
  MOCK_INVALID_REFRESH_TOKEN,
  MOCK_OAUTH_CLIENT_IDS,
  MOCK_SEEDED_ACCESS_TOKEN,
  MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN,
  MOCK_SEEDED_REFRESH_TOKEN,
  MOCK_USER_CODE,
  REAL_VSCODE_CLIENT_ID,
  resetMoocOAuthState,
  setDeviceFlowClock,
} from "./oauth"
import type { MoocMockControls } from "./router"
import { createMoocApp, moocMockOf } from "./router"

// These endpoints (see backend/mooc/oauth.ts) are outside the vendored
// exercise-services OpenAPI spec, so — unlike conformance.test.ts — there's no
// spec to validate against; this test pins the RFC 8628 behavior directly.

const listen = (app: Express): Promise<{ server: Server; base: string; mock: MoocMockControls }> =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        throw new Error("expected a TCP address")
      }
      resolve({ server, base: `http://localhost:${addr.port}`, mock: moocMockOf(app) })
    })
  })

// Drives the injectable device-flow clock deterministically. The advertised
// interval is 5s, so advancing by 6000ms crosses exactly one interval.
const useClock = (start = 1_000_000): { advance: (ms: number) => void } => {
  let t = start
  setDeviceFlowClock(() => t)
  return { advance: (ms: number) => void (t += ms) }
}

describe("mooc device-flow oauth mock", () => {
  let server: Server
  let base: string

  before(async () => {
    ;({ server, base } = await listen(createMoocApp()))
  })

  after(() => {
    server.close()
  })

  afterEach(() => {
    resetMoocOAuthState()
  })

  const oauth = (p: string): string => `${base}/api/v0/main-frontend/oauth${p}`

  const postForm = (p: string, fields: Record<string, string>): Promise<Response> =>
    fetch(oauth(p), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    })

  const deviceAuthorization = (clientId: string) =>
    postForm("/device_authorization", { client_id: clientId, scope: "exercise-services" })

  const pollToken = (deviceCode: string, clientId: string) =>
    postForm("/token", {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
      client_id: clientId,
    })

  test("device_authorization returns the RFC 8628 fields", async () => {
    const res = await deviceAuthorization(REAL_VSCODE_CLIENT_ID)
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(typeof body.device_code, "string")
    assert.equal(body.user_code, MOCK_USER_CODE)
    assert.match(String(body.verification_uri), /\/oauth_device$/)
    assert.match(String(body.verification_uri_complete), /user_code=/)
    assert.equal(typeof body.expires_in, "number")
    assert.equal(typeof body.interval, "number")
  })

  test("default client: pending before the interval elapses, then an approved token pair", async () => {
    const client = REAL_VSCODE_CLIENT_ID
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }

    // before one poll interval of wall-clock time has elapsed -> still pending
    const pending = await pollToken(auth.device_code, client)
    assert.equal(pending.status, 400)
    assert.equal(((await pending.json()) as { error: string }).error, "authorization_pending")

    // once an interval has elapsed -> approved
    clock.advance(6000)
    const approved = await pollToken(auth.device_code, client)
    assert.equal(approved.status, 200)
    const token = (await approved.json()) as Record<string, unknown>
    assert.equal(typeof token.access_token, "string")
    assert.equal(typeof token.refresh_token, "string")
    // Byte-faithful to sp331: capitalised "Bearer", no `scope` field.
    assert.equal(token.token_type, "Bearer")
    assert.equal(token.scope, undefined)
  })

  test("deny client: access_denied, with an error_description", async () => {
    const client = MOCK_OAUTH_CLIENT_IDS.deny
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    const res = await pollToken(auth.device_code, client)
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string; error_description: string }
    assert.equal(body.error, "access_denied")
    // The real sp331 OAuth error body carries an error_description (OAuthErrorData).
    assert.equal(typeof body.error_description, "string")
    assert.ok(body.error_description.length > 0)
  })

  test("expired client: expired_token", async () => {
    const client = MOCK_OAUTH_CLIENT_IDS.expired
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    const res = await pollToken(auth.device_code, client)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "expired_token")
  })

  test("never client: always authorization_pending", async () => {
    const client = MOCK_OAUTH_CLIENT_IDS.never
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    for (let i = 0; i < 3; i++) {
      const res = await pollToken(auth.device_code, client)
      assert.equal(res.status, 400)
      assert.equal(((await res.json()) as { error: string }).error, "authorization_pending")
      // Respect the advertised interval, or the next poll is a slow_down.
      clock.advance(6000)
    }
  })

  test("slow_down client: slow_down, then pending, then approved (wall-clock)", async () => {
    const client = MOCK_OAUTH_CLIENT_IDS.slowDown
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }

    // within the first interval -> slow_down (polled too soon)
    const first = await pollToken(auth.device_code, client)
    assert.equal(((await first.json()) as { error: string }).error, "slow_down")

    // after one interval -> authorization_pending
    clock.advance(6000)
    const second = await pollToken(auth.device_code, client)
    assert.equal(((await second.json()) as { error: string }).error, "authorization_pending")

    // after two intervals -> approved
    clock.advance(6000)
    const third = await pollToken(auth.device_code, client)
    assert.equal(third.status, 200)
    assert.equal(typeof ((await third.json()) as { access_token: string }).access_token, "string")
  })

  test("an issued device code past its lifetime is rejected as expired_token", async () => {
    const client = REAL_VSCODE_CLIENT_ID
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as {
      device_code: string
      expires_in: number
    }
    clock.advance(auth.expires_in * 1000 + 1000)
    const res = await pollToken(auth.device_code, client)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "expired_token")
  })

  test("unknown device code: invalid_grant", async () => {
    // `expired_token` is reserved for a code the provider still holds and whose
    // lifetime has run out; one it never issued is simply not a grant.
    const res = await pollToken("no-such-device-code", REAL_VSCODE_CLIENT_ID)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "invalid_grant")
  })

  test("an approved device code is consumed: a second redemption is invalid_grant", async () => {
    const client = REAL_VSCODE_CLIENT_ID
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    clock.advance(6000)
    assert.equal((await pollToken(auth.device_code, client)).status, 200)

    clock.advance(6000)
    const again = await pollToken(auth.device_code, client)
    assert.equal(again.status, 400)
    assert.equal(((await again.json()) as { error: string }).error, "invalid_grant")
  })

  test("a device code issued to one client cannot be redeemed by another", async () => {
    const clock = useClock()
    const auth = (await (await deviceAuthorization(REAL_VSCODE_CLIENT_ID)).json()) as {
      device_code: string
    }
    clock.advance(6000)
    const res = await pollToken(auth.device_code, MOCK_OAUTH_CLIENT_IDS.never)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "invalid_grant")
  })

  test("polling faster than the advertised interval earns slow_down", async () => {
    const client = REAL_VSCODE_CLIENT_ID
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    // First poll sets the baseline; nothing to be too fast relative to yet.
    assert.equal(
      ((await (await pollToken(auth.device_code, client)).json()) as { error: string }).error,
      "authorization_pending",
    )
    clock.advance(100)
    const tooSoon = await pollToken(auth.device_code, client)
    assert.equal(((await tooSoon.json()) as { error: string }).error, "slow_down")
  })

  test("an approved grant outranks the poll rate, so eager polling still logs in", async () => {
    // The client that polled too fast must still get its token once the user has
    // authorized -- otherwise a fast poller could never finish the flow.
    const client = REAL_VSCODE_CLIENT_ID
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    await pollToken(auth.device_code, client)
    clock.advance(6000)
    assert.equal((await pollToken(auth.device_code, client)).status, 200)
  })

  test("device_authorization rejects a scope the client was never granted", async () => {
    const res = await postForm("/device_authorization", {
      client_id: REAL_VSCODE_CLIENT_ID,
      scope: "exercise-services admin",
    })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "invalid_scope")
  })

  test("device_authorization rejects an unregistered client_id with invalid_client", async () => {
    const res = await deviceAuthorization("some-unregistered-client")
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string; error_description: string }
    assert.equal(body.error, "invalid_client")
    assert.equal(typeof body.error_description, "string")
    assert.ok(body.error_description.length > 0)
  })

  test("device_authorization accepts the real CLI client id", async () => {
    const res = await deviceAuthorization(REAL_VSCODE_CLIENT_ID)
    assert.equal(res.status, 200)
  })

  const refresh = (refreshToken: string, clientId = REAL_VSCODE_CLIENT_ID) =>
    postForm("/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    })

  // Runs the device flow to approval and returns the minted pair.
  const login = async (
    client = REAL_VSCODE_CLIENT_ID,
  ): Promise<{ access_token: string; refresh_token: string }> => {
    const clock = useClock()
    const auth = (await (await deviceAuthorization(client)).json()) as { device_code: string }
    clock.advance(6000)
    return (await (await pollToken(auth.device_code, client)).json()) as {
      access_token: string
      refresh_token: string
    }
  }

  test("the seeded refresh token always mints a fresh pair", async () => {
    const res = await refresh(MOCK_SEEDED_REFRESH_TOKEN)
    assert.equal(res.status, 200)
    const token = (await res.json()) as Record<string, unknown>
    assert.equal(typeof token.access_token, "string")
    assert.equal(typeof token.refresh_token, "string")
    assert.equal(token.token_type, "Bearer")
  })

  test("a refresh token the provider never issued is invalid_grant", async () => {
    const res = await refresh("some-refresh-token")
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "invalid_grant")
  })

  test("a refresh rotates: the redeemed token no longer works", async () => {
    const minted = await login()
    const rotated = (await (await refresh(minted.refresh_token)).json()) as {
      refresh_token: string
    }
    assert.notEqual(rotated.refresh_token, minted.refresh_token)
    const replay = await refresh(minted.refresh_token)
    assert.equal(replay.status, 400)
    assert.equal(((await replay.json()) as { error: string }).error, "invalid_grant")
  })

  test("replaying a rotated refresh token revokes the whole chain", async () => {
    const minted = await login()
    const rotated = (await (await refresh(minted.refresh_token)).json()) as {
      access_token: string
      refresh_token: string
    }
    await refresh(minted.refresh_token) // the reuse that trips detection

    const res = await fetch(`${base}/api/v0/exercise-services/client/courses`, {
      headers: { authorization: `Bearer ${rotated.access_token}` },
    })
    assert.equal(res.status, 401)
    assert.equal((await refresh(rotated.refresh_token)).status, 400)
  })

  test("a refresh token presented by another client is invalid_grant", async () => {
    const minted = await login()
    const res = await refresh(minted.refresh_token, MOCK_OAUTH_CLIENT_IDS.never)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "invalid_grant")
  })

  test("a minted access token stops working once its lifetime has elapsed", async () => {
    const clock = useClock()
    const auth = (await (await deviceAuthorization(REAL_VSCODE_CLIENT_ID)).json()) as {
      device_code: string
    }
    clock.advance(6000)
    const minted = (await (await pollToken(auth.device_code, REAL_VSCODE_CLIENT_ID)).json()) as {
      access_token: string
      expires_in: number
    }

    const courses = `${base}/api/v0/exercise-services/client/courses`
    const authorization = { authorization: `Bearer ${minted.access_token}` }
    assert.equal((await fetch(courses, { headers: authorization })).status, 200)
    clock.advance(minted.expires_in * 1000 + 1000)
    assert.equal((await fetch(courses, { headers: authorization })).status, 401)
  })

  test("refresh grant rejects the invalid-refresh sentinel with invalid_grant", async () => {
    const res = await postForm("/token", {
      grant_type: "refresh_token",
      refresh_token: MOCK_INVALID_REFRESH_TOKEN,
      client_id: "tmc-vscode",
    })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string; error_description: string }
    assert.equal(body.error, "invalid_grant")
    assert.equal(typeof body.error_description, "string")
  })

  test("unsupported grant type: 400", async () => {
    const res = await postForm("/token", { grant_type: "password" })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, "unsupported_grant_type")
  })
})

// Mirrors the sp331 UserFromOAuthToken extractor: missing/invalid token -> 401
// `unauthorized`, a recognised token without the exercise-services scope -> 403
// `forbidden`, both with the exact sp331 envelope.
describe("mooc resource-endpoint bearer auth mode", () => {
  const COURSES_PATH = "/api/v0/exercise-services/client/courses"

  const get = (base: string, token?: string): Promise<Response> =>
    fetch(`${base}${COURSES_PATH}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })

  describe("with requireAuth", () => {
    let server: Server
    let base: string
    let mock: MoocMockControls

    before(async () => {
      ;({ server, base, mock } = await listen(createMoocApp({ requireAuth: true })))
    })
    after(() => {
      server.close()
    })
    afterEach(() => {
      resetMoocOAuthState()
      mock.reset()
    })

    test("missing bearer -> 401 with the sp331 unauthorized envelope", async () => {
      const res = await get(base)
      assert.equal(res.status, 401)
      const body = (await res.json()) as Record<string, unknown>
      assert.equal(body.type, "unauthorized")
      assert.equal(body.message_key, "unauthorized")
      assert.equal(typeof body.message, "string")
      // The live serializer omits an empty errors array / absent metadata.
      assert.equal("errors" in body, false)
      assert.equal("metadata" in body, false)
    })

    test("unknown/invalid bearer -> 401", async () => {
      const res = await get(base, "not-a-real-token")
      assert.equal(res.status, 401)
      assert.equal(((await res.json()) as { type: string }).type, "unauthorized")
    })

    test("recognised token lacking the scope -> 403 forbidden envelope", async () => {
      const res = await get(base, MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN)
      assert.equal(res.status, 403)
      const body = (await res.json()) as Record<string, unknown>
      assert.equal(body.type, "forbidden")
      assert.equal(body.message_key, "forbidden")
    })

    test("seeded valid scoped token -> 200", async () => {
      const res = await get(base, MOCK_SEEDED_ACCESS_TOKEN)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(await res.json()))
    })

    test("a token minted via the device flow -> 200", async () => {
      const oauth = (p: string, fields: Record<string, string>): Promise<Response> =>
        fetch(`${base}/api/v0/main-frontend/oauth${p}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        })
      const client = REAL_VSCODE_CLIENT_ID
      let t = 1_000_000
      setDeviceFlowClock(() => t)
      const auth = (await (
        await oauth("/device_authorization", { client_id: client, scope: "exercise-services" })
      ).json()) as { device_code: string }
      await oauth("/token", {
        grant_type: DEVICE_GRANT_TYPE,
        device_code: auth.device_code,
        client_id: client,
      }) // before the interval: pending
      t += 6000 // cross one interval -> the next poll is approved
      const approved = (await (
        await oauth("/token", {
          grant_type: DEVICE_GRANT_TYPE,
          device_code: auth.device_code,
          client_id: client,
        })
      ).json()) as { access_token: string }

      const res = await get(base, approved.access_token)
      assert.equal(res.status, 200)
    })

    test("the expire-access-token route makes the next call 401", async () => {
      // The out-of-process lever for the reactive refresh path: the client still
      // believes its stored token is good, so the 401 comes as a surprise.
      assert.equal((await get(base, MOCK_SEEDED_ACCESS_TOKEN)).status, 200)
      const expired = await fetch(`${base}/mooc-mock/expire-access-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: MOCK_SEEDED_ACCESS_TOKEN }),
      })
      assert.equal(expired.status, 204)
      assert.equal((await get(base, MOCK_SEEDED_ACCESS_TOKEN)).status, 401)
    })

    test("expiring a token the mock never issued is a 404", async () => {
      const res = await fetch(`${base}/mooc-mock/expire-access-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "never-issued" }),
      })
      assert.equal(res.status, 404)
    })

    test("records the Authorization header for cross-process observation", async () => {
      await get(base, MOCK_SEEDED_ACCESS_TOKEN)
      const state = (await (await fetch(`${base}/mooc-mock/auth-state`)).json()) as {
        lastAuthorization: string
        authenticatedRequestCount: number
      }
      assert.equal(state.lastAuthorization, `Bearer ${MOCK_SEEDED_ACCESS_TOKEN}`)
      assert.ok(state.authenticatedRequestCount > 0)
    })
  })

  describe("default mock now requires bearer auth", () => {
    let server: Server
    let base: string

    before(async () => {
      ;({ server, base } = await listen(createMoocApp()))
    })
    after(() => {
      server.close()
    })

    test("no bearer is rejected with 401", async () => {
      const res = await get(base)
      assert.equal(res.status, 401)
      assert.equal(((await res.json()) as { type: string }).type, "unauthorized")
    })

    test("a valid seeded bearer still succeeds", async () => {
      const res = await get(base, MOCK_SEEDED_ACCESS_TOKEN)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(await res.json()))
    })
  })

  describe("explicit requireAuth:false opts out of bearer auth", () => {
    let server: Server
    let base: string

    before(async () => {
      ;({ server, base } = await listen(createMoocApp({ requireAuth: false })))
    })
    after(() => {
      server.close()
    })

    test("no bearer still succeeds", async () => {
      const res = await get(base)
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(await res.json()))
    })
  })
})
