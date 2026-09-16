import { vi } from "vitest"

import Langs from "../../api/langs"
import { EmptyLangsResponseError, LangsResponseSchemaError, SpawnError } from "../../errors"
import { Logger } from "../../utilities/logger"

type FakeListener = (...args: unknown[]) => void

interface FakeStream {
  on: (event: string, listener: FakeListener) => FakeStream
  emit: (event: string, ...args: unknown[]) => void
}

interface FakeChildProcess extends FakeStream {
  pid: number
  stdout: FakeStream
  stderr: FakeStream
  stdin: { write: (chunk: string) => void }
}

// The CLI boundary has no seam of its own, so the tests drive it by replacing
// `child_process.spawn` with a process whose streams and lifecycle events they emit.
const spawnedProcesses: FakeChildProcess[] = vi.hoisted(() => [])
const killedPids: number[] = vi.hoisted(() => [])

vi.mock("child_process", () => {
  const makeStream = (): FakeStream => {
    const listeners = new Map<string, FakeListener[]>()
    const stream: FakeStream = {
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return stream
      },
      emit: (event, ...args) => {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args)
        }
      },
    }
    return stream
  }
  return {
    spawn: (): FakeChildProcess => {
      const langsProcess: FakeChildProcess = {
        ...makeStream(),
        pid: 1000 + spawnedProcesses.length,
        stdout: makeStream(),
        stderr: makeStream(),
        stdin: { write: (): void => {} },
      }
      spawnedProcesses.push(langsProcess)
      return langsProcess
    },
  }
})

vi.mock("tree-kill", () => ({
  default: (pid: number): void => {
    killedPids.push(pid)
  },
}))

function newLangs(): Langs {
  return new Langs("dummy-cli-path", "test-client", "1.0.0")
}

function lastProcess(): FakeChildProcess {
  const langsProcess = spawnedProcesses.at(-1)
  if (!langsProcess) {
    throw new Error("the CLI was never spawned")
  }
  return langsProcess
}

function writeStdout(langsProcess: FakeChildProcess, ...lines: string[]): void {
  langsProcess.stdout.emit("data", lines.join("\n") + "\n")
}

/** The process `exit` and the stdout `end` race; the runner settles only once both fired. */
function endProcess(
  langsProcess: FakeChildProcess,
  order: "exit-first" | "end-first" = "exit-first",
): void {
  const exit = (): void => langsProcess.emit("exit", 0)
  const end = (): void => langsProcess.stdout.emit("end")
  if (order === "exit-first") {
    exit()
    end()
  } else {
    end()
    exit()
  }
}

const TOKEN = "super-secret-refresh-token"

function loggedInLine(): string {
  return JSON.stringify({
    "output-kind": "output-data",
    status: "finished",
    message: "logged in",
    result: "logged-in",
    data: null,
  })
}

/** A login envelope carrying a live token, rejected because `status` is not a known value. */
function driftedTokenLine(): string {
  return JSON.stringify({
    "output-kind": "output-data",
    status: "aborted",
    message: "logged in",
    result: "logged-in",
    data: {
      "output-data-kind": "token",
      "output-data": { access_token: TOKEN, refresh_token: TOKEN },
    },
  })
}

/** Replaces every `Logger` sink with a recorder, so a test can assert what was written. */
function captureLogs(): unknown[][] {
  const captured: unknown[][] = []
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(Logger, level).mockImplementation((...params: unknown[]): void => {
      captured.push(params)
    })
  }
  return captured
}

function loggedText(captured: unknown[][]): string {
  return captured
    .flat()
    .map((param) => (typeof param === "string" ? param : (JSON.stringify(param) ?? "")))
    .join("\n")
}

function crashedLine(message: string): string {
  return JSON.stringify({
    "output-kind": "output-data",
    status: "crashed",
    message,
    result: "error",
    data: null,
  })
}

beforeEach(function () {
  spawnedProcesses.length = 0
  killedPids.length = 0
})

afterEach(function () {
  vi.restoreAllMocks()
})

suite("Langs CLI process failures", function () {
  const panicMessage = "Process panicked unexpectedly with message: index out of bounds"

  test("a panic is reported with the CLI's panic message", async function () {
    const langs = newLangs()
    const pending = langs.getTmcOrganizations()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, crashedLine(panicMessage))
    endProcess(langsProcess)

    const result = await pending
    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain(panicMessage)
  })

  test("a panic on a command expecting no data is reported the same way", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, crashedLine(panicMessage))
    endProcess(langsProcess)

    const result = await pending
    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain(panicMessage)
  })

  test("a CLI that cannot be started is reported as a spawn failure", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    langsProcess.stderr.emit("data", "permission denied")
    langsProcess.emit(
      "error",
      Object.assign(new Error("spawn dummy-cli-path EACCES"), { errno: -13, code: "EACCES" }),
    )

    const result = await pending
    expect(result.val).toBeInstanceOf(SpawnError)
    expect((result.val as SpawnError).message).toContain("EACCES")
    expect((result.val as SpawnError).details).toContain("permission denied")
  })

  test("a macOS architecture mismatch carries the Rosetta instructions", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    langsProcess.emit(
      "error",
      Object.assign(new Error("spawn Unknown system error -88"), { errno: -88 }),
    )

    const result = await pending
    expect(result.val).toBeInstanceOf(SpawnError)
    expect((result.val as SpawnError).message).toContain("softwareupdate --install-rosetta")
  })
})

suite("Langs CLI process output", function () {
  test("the result settles when exit precedes the stdout end", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, loggedInLine())
    endProcess(langsProcess, "exit-first")

    expect(await pending).toEqual(expect.objectContaining({ val: true }))
  })

  test("the result settles when the stdout end precedes exit", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, loggedInLine())
    endProcess(langsProcess, "end-first")

    expect(await pending).toEqual(expect.objectContaining({ val: true }))
  })

  test("a process that writes nothing reports an empty response", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    endProcess(lastProcess())

    const result = await pending
    expect(result.val).toBeInstanceOf(EmptyLangsResponseError)
  })

  test("output the CLI contract rejects reports the schema mismatch", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, driftedTokenLine())
    endProcess(langsProcess)

    const result = await pending
    expect(result.val).toBeInstanceOf(LangsResponseSchemaError)
    expect((result.val as Error).message).toContain("output-data")
  })

  test("a rejected line never reaches the log", async function () {
    const captured = captureLogs()
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, driftedTokenLine())
    endProcess(langsProcess)
    await pending

    const text = loggedText(captured)
    expect(text).toContain("didn't match expected type")
    expect(text).not.toContain(TOKEN)
  })

  test("an unterminated tail never reaches the log", async function () {
    const captured = captureLogs()
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    writeStdout(langsProcess, loggedInLine())
    langsProcess.stdout.emit("data", `{"access_token":"${TOKEN}`)
    endProcess(langsProcess)

    expect(await pending).toEqual(expect.objectContaining({ val: true }))
    const text = loggedText(captured)
    expect(text).toContain("unterminated")
    expect(text).not.toContain(TOKEN)
  })

  test("status updates reach the caller", async function () {
    const langs = newLangs()
    const deviceCodes: string[] = []
    const login = langs.authenticateMooc((info) => deviceCodes.push(info.user_code))
    const langsProcess = lastProcess()
    writeStdout(
      langsProcess,
      JSON.stringify({
        "output-kind": "status-update",
        "update-data-kind": "mooc-device-login",
        finished: false,
        message: "Waiting for approval",
        "percent-done": 0,
        time: 1,
        data: {
          expires_in: 600,
          interval: 5,
          user_code: "ABCD-EFGH",
          verification_uri: "https://courses.mooc.fi/oauth_device",
          verification_uri_complete: null,
        },
      }),
      loggedInLine(),
    )
    endProcess(langsProcess)

    expect((await login.result).ok).toBe(true)
    expect(deviceCodes).toEqual(["ABCD-EFGH"])
  })
})

suite("Langs CLI process cancellation", function () {
  test("an interrupted process is reported as killed", async function () {
    const langs = newLangs()
    const login = langs.authenticateMooc(() => {})
    const langsProcess = lastProcess()
    login.interrupt()
    endProcess(langsProcess)

    const result = await login.result
    expect((result.val as Error).message).toContain("killed")
    expect(killedPids).toContain(langsProcess.pid)
  })

  test("a process that outlives its timeout is killed and reported", async function () {
    vi.useFakeTimers()
    try {
      const langs = newLangs()
      const pending = langs.isAuthenticated({ timeout: 5000 })
      const langsProcess = lastProcess()
      vi.advanceTimersByTime(5000)

      const result = await pending
      expect((result.val as Error).message).toContain("really long time")
      expect(killedPids).toContain(langsProcess.pid)
    } finally {
      vi.useRealTimers()
    }
  })
})
