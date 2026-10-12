// What a test tier needs to start a session against the shared mock backend.
// Kept free of imports so the integration and Playwright tiers can load it
// without the mock's express types on their resolution path.

/** Where the shared mock backend (backend/index.ts) listens by default. */
export const MOCK_BACKEND_URL = "http://localhost:4001"

/**
 * tmc-langs' per-client config directory, `tmc-<client name>`, for the
 * extension's `CLIENT_NAME` in src/config/constants.ts. That module cannot be
 * loaded outside the extension bundle, so the integration tier pins the two
 * together.
 */
export const CLIENT_CONFIG_DIR_NAME = "tmc-vscode_plugin"

/**
 * The legacy tmc token the TMC mock accepts, standing in for a
 * `credentials.json` written before `tmc login` was removed.
 */
export const MOCK_TMC_ACCESS_TOKEN = "mock-tmc-access-token"

// Tokens the mooc mock recognises without a device-flow round trip, so a tier
// can seed the credentials file directly. Every mock reset restores them.
/** Scoped, never expires unless a test expires it; the TMC mock accepts it too. */
export const MOCK_SEEDED_ACCESS_TOKEN = "mock-seeded-access-token"
/** Recognised but lacking the exercise-services scope, so resource calls are 403. */
export const MOCK_SEEDED_NOSCOPE_ACCESS_TOKEN = "mock-seeded-noscope-access-token"
/** Issued to the real client id; single-use like a minted one, so replaying it revokes its family. */
export const MOCK_SEEDED_REFRESH_TOKEN = "mock-seeded-refresh-token"
/** Always `invalid_grant`, driving the CLI's refresh-then-delete path. */
export const MOCK_INVALID_REFRESH_TOKEN = "mock-invalid-refresh-token"

/** The user code the mooc mock shows on the `attempt`th device authorization since its last reset. */
export const mockUserCode = (attempt: number): string => `WXYZ-${String(attempt).padStart(4, "0")}`

/** The body of a `credentials.json` holding a legacy tmc token. */
export const tmcCredentials = (
  accessToken: string = MOCK_TMC_ACCESS_TOKEN,
): Record<string, string> => ({
  access_token: accessToken,
  token_type: "bearer",
  scope: "public",
})
