import { vi } from "vitest"

import Langs from "../../api/langs"
import {
  EmptyLangsResponseError,
  LangsResponseSchemaError,
  SpawnError,
  TimeoutError,
} from "../../errors"
import { ExerciseIdentifier } from "../../shared/shared"
import { Logger } from "../../utilities/logger"

type FakeListener = (...args: unknown[]) => void

interface FakeStream {
  on: (event: string, listener: FakeListener) => FakeStream
  setEncoding: (encoding: BufferEncoding) => FakeStream
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
  // Buffers are delivered decoded only once an encoding is set, the way a real
  // stream does it -- otherwise a character split across two chunks is not observable.
  const makeStream = (): FakeStream => {
    const listeners = new Map<string, FakeListener[]>()
    let decoder: InstanceType<typeof TextDecoder> | undefined
    const stream: FakeStream = {
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return stream
      },
      setEncoding: (encoding) => {
        decoder = new TextDecoder(encoding)
        return stream
      },
      emit: (event, ...args) => {
        let params = args
        if (event === "data" && decoder && Buffer.isBuffer(args[0])) {
          const text = decoder.decode(args[0], { stream: true })
          if (text === "") {
            return
          }
          params = [text, ...args.slice(1)]
        }
        for (const listener of listeners.get(event) ?? []) {
          listener(...params)
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

// Process groups the runner signalled. `process.kill` is stubbed rather than let through:
// the fake pids below name no real process, so a real signal could land on an unrelated
// group.
const killedProcessGroups: number[] = []

/**
 * Pids whose whole tree the runner killed, by whichever mechanism the platform uses:
 * one signal to the child's own process group on POSIX, a `tree-kill` walk on Windows.
 */
function killedProcessTrees(): number[] {
  return process.platform === "win32" ? killedPids : killedProcessGroups
}

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

/** Cuts `text` at a UTF-8 continuation byte, so the two halves split a character. */
function splitMidCharacter(text: string): [Buffer, Buffer] {
  const bytes = Buffer.from(text, "utf8")
  const at = bytes.findIndex((byte) => (byte & 0xc0) === 0x80)
  if (at <= 0) {
    throw new Error("the text has no multi-byte character to split")
  }
  return [bytes.subarray(0, at), bytes.subarray(at)]
}

beforeEach(function () {
  spawnedProcesses.length = 0
  killedPids.length = 0
  killedProcessGroups.length = 0
  vi.spyOn(process, "kill").mockImplementation(((pid: number): true => {
    killedProcessGroups.push(-pid)
    return true
  }) as typeof process.kill)
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
    expect((result.val as SpawnError).details).toBe("permission denied")
  })

  test("stderr past the retention cap keeps the newest output and counts the rest", async function () {
    const langs = newLangs()
    const pending = langs.isAuthenticated()
    const langsProcess = lastProcess()
    const filler = "x".repeat(8 * 1024)
    langsProcess.stderr.emit("data", `oldest ${filler}`)
    for (let written = 0; written < 16; written++) {
      langsProcess.stderr.emit("data", filler)
    }
    langsProcess.stderr.emit("data", `newest ${filler}`)
    langsProcess.emit("error", new Error("spawn dummy-cli-path ENOENT"))

    const retained = ((await pending).val as SpawnError).details ?? ""
    expect(retained).toContain("newest")
    expect(retained).not.toContain("oldest")
    expect(retained).toContain("bytes of earlier stderr dropped")
    expect(retained.length).toBeLessThan(80 * 1024)
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

  test("a character split across two chunks arrives intact", async function () {
    const message = "Testit epäonnistuivat: ääkköset"
    const langs = newLangs()
    const pending = langs.getTmcOrganizations()
    const langsProcess = lastProcess()
    const [head, tail] = splitMidCharacter(crashedLine(message) + "\n")
    langsProcess.stdout.emit("data", head)
    langsProcess.stdout.emit("data", tail)
    endProcess(langsProcess)

    const result = await pending
    expect((result.val as Error).message).toContain(message)
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

  test("a CLI notification is logged and delivered once per distinct message", async function () {
    const captured = captureLogs()
    const langs = newLangs()
    const delivered: string[] = []
    langs.on("notification", (notification) => delivered.push(notification.message))
    const testRun = langs.runTests("/exercise")
    const langsProcess = lastProcess()
    const warning = JSON.stringify({
      "output-kind": "notification",
      "notification-kind": "warning",
      message: "Your Python is out of date",
    })
    writeStdout(langsProcess, warning, warning)
    endProcess(langsProcess)
    await testRun.process

    expect(delivered).toEqual(["Your Python is out of date"])
    expect(loggedText(captured)).toContain("Your Python is out of date")
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
    expect(killedProcessTrees()).toContain(langsProcess.pid)
  })

  test("interrupting a process that already exited signals nothing", async function () {
    const langs = newLangs()
    const login = langs.authenticateMooc(() => {})
    const langsProcess = lastProcess()
    endProcess(langsProcess)
    await login.result

    // The pid is the OS's to reuse by now, so the retained closure must be inert.
    login.interrupt()
    expect(killedProcessTrees()).toEqual([])
  })

  test("interrupting a process that failed to start signals nothing", async function () {
    const langs = newLangs()
    const login = langs.authenticateMooc(() => {})
    const langsProcess = lastProcess()
    langsProcess.emit("error", Object.assign(new Error("spawn ENOENT"), { errno: -2 }))
    await login.result

    login.interrupt()
    expect(killedProcessTrees()).toEqual([])
  })

  test("a process that outlives its timeout is killed and reported as a timeout", async function () {
    vi.useFakeTimers()
    try {
      const langs = newLangs()
      const pending = langs.isAuthenticated({ timeout: 5000 })
      const langsProcess = lastProcess()
      vi.advanceTimersByTime(5000)

      const result = await pending
      expect(result.val).toBeInstanceOf(TimeoutError)
      expect((result.val as Error).message).toContain("really long time")
      expect(killedProcessTrees()).toContain(langsProcess.pid)
    } finally {
      vi.useRealTimers()
    }
  })

  test("killAllProcesses kills an in-flight submit's process tree", async function () {
    const langs = newLangs()
    const submitting = langs.submitTmcExerciseToPaste(101, "/ex")
    const langsProcess = lastProcess()

    langs.killAllProcesses()
    expect(killedProcessTrees()).toContain(langsProcess.pid)

    endProcess(langsProcess)
    expect((await submitting).err).toBe(true)
  })

  test("killAllProcesses kills an in-flight test run's process tree", async function () {
    const langs = newLangs()
    const running = langs.runTests("/ex")
    const langsProcess = lastProcess()

    langs.killAllProcesses()
    expect(killedProcessTrees()).toContain(langsProcess.pid)

    endProcess(langsProcess)
    expect((await running.process).err).toBe(true)
  })

  test("killAllProcesses leaves a download alone, so it can't be cut in half", async function () {
    const langs = newLangs()
    const downloading = langs.downloadExercises([ExerciseIdentifier.from(1)], false, () => {})
    const langsProcess = lastProcess()

    langs.killAllProcesses()
    expect(killedProcessTrees()).toEqual([])

    endProcess(langsProcess)
    await downloading
  })

  test("killAllProcesses stops tracking a process once it settles", async function () {
    const langs = newLangs()
    const pasting = langs.submitTmcExerciseToPaste(101, "/ex")
    const langsProcess = lastProcess()
    endProcess(langsProcess)
    await pasting

    langs.killAllProcesses()
    expect(killedProcessTrees()).toEqual([])
  })
})
