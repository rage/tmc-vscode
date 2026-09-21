/**
 * The only access token the legacy TMC mock's API accepts, and what its
 * `/oauth/token` issues. Tiers that start from a logged-in extension write it
 * straight into `credentials.json`; every other token gets the 401 a real
 * rejected token gets.
 *
 * Kept in a module of its own, with no imports: the integration and Playwright
 * tiers typecheck without the mock's express types on their resolution path.
 */
export const MOCK_TMC_ACCESS_TOKEN = "mock-tmc-access-token"
