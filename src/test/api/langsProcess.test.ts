import { vi } from "vitest"

import Langs from "../../api/langs"
import { SpawnError } from "../../errors"

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
