import applicationRouter from "./application"
import langsRounter from "./langs"
import oauthRouter from "./oauth"

export { MOCK_TMC_ACCESS_TOKEN } from "./accessToken"
export { applicationRouter, langsRounter, oauthRouter }
export type { TmcMockControls } from "./v8"
export { createTmcApp, registerV8Routes, tmcMockOf } from "./v8"
