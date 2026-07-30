import { vi } from "vitest"

import Langs from "../../api/langs"

// The env is assembled inside `_spawnLangsProcess`, so the assertion has to reach
// the actual `cp.spawn` call. The mock records the env and aborts the spawn, so no
// real CLI runs.
const spawnCalls: { env: NodeJS.ProcessEnv | undefined }[] = vi.hoisted(() => [])

vi.mock("child_process", () => ({
  spawn: (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ env: options.env })
    throw new Error("stopped before spawning a real process")
  },
}))

const moocEnvKeys = [
  "TMC_LANGS_MOOC_ROOT_URL",
  "TMC_LANGS_MOOC_CLIENT_ID",
  "TMC_LANGS_MOOC_TRUST_LOCALHOST",
] as const

suite("Langs CLI environment", function () {
  const saved = new Map<string, string | undefined>()

  beforeEach(function () {
    for (const key of moocEnvKeys) {
      saved.set(key, process.env[key])
    }
    process.env.TMC_LANGS_MOOC_ROOT_URL = "http://localhost:4001"
    process.env.TMC_LANGS_MOOC_CLIENT_ID = "test-client-id"
    process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST = "1"
    spawnCalls.length = 0
  })

  afterEach(function () {
    for (const key of moocEnvKeys) {
      const value = saved.get(key)
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = value
      }
    }
    vi.restoreAllMocks()
  })

  // The tmc code path authenticates with the courses.mooc.fi access token, so it
  // needs the mooc backend URL and OAuth knobs just as much as `mooc` commands
  // do. Missing TMC_LANGS_MOOC_TRUST_LOCALHOST is the silent case: the CLI would
  // then attach no bearer to a localhost backend and run unauthenticated.
  test("a tmc command carries the mooc backend url and oauth knobs", async function () {
    const langs = new Langs("dummy-cli-path", "test-client", "1.0.0")

    await langs.isAuthenticated()

    const captured = spawnCalls[0]
    expect(captured?.env?.TMC_LANGS_MOOC_ROOT_URL).toBe("http://localhost:4001")
    expect(captured?.env?.TMC_LANGS_MOOC_CLIENT_ID).toBe("test-client-id")
    expect(captured?.env?.TMC_LANGS_MOOC_TRUST_LOCALHOST).toBe("1")
  })

  test("a mooc command carries them too", async function () {
    const langs = new Langs("dummy-cli-path", "test-client", "1.0.0")

    await langs.isMoocAuthenticated()

    const captured = spawnCalls[0]
    expect(captured?.env?.TMC_LANGS_MOOC_ROOT_URL).toBe("http://localhost:4001")
    expect(captured?.env?.TMC_LANGS_MOOC_CLIENT_ID).toBe("test-client-id")
    expect(captured?.env?.TMC_LANGS_MOOC_TRUST_LOCALHOST).toBe("1")
  })

  test("unset oauth knobs are not passed as empty strings", async function () {
    delete process.env.TMC_LANGS_MOOC_CLIENT_ID
    delete process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST
    const langs = new Langs("dummy-cli-path", "test-client", "1.0.0")

    await langs.isAuthenticated()

    const captured = spawnCalls[0]
    expect(captured?.env && "TMC_LANGS_MOOC_CLIENT_ID" in captured.env).toBe(false)
    expect(captured?.env && "TMC_LANGS_MOOC_TRUST_LOCALHOST" in captured.env).toBe(false)
  })
})
