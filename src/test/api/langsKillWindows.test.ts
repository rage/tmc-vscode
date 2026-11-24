import { vi } from "vitest"

const execFileCalls: { command: string; args: string[]; options: unknown }[] = vi.hoisted(() => [])
const platform = vi.hoisted(() => {
  const original = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  return original
})

const makeStream = (): Record<string, unknown> => ({
  on: (): unknown => makeStream(),
  setEncoding: (): void => {},
  destroy: (): void => {},
})

vi.mock("child_process", () => {
  return {
    spawn: (): Record<string, unknown> => ({
      ...makeStream(),
      pid: 4242,
      stdout: makeStream(),
      stderr: makeStream(),
    }),
    execFile: (
      command: string,
      args: string[],
      options: unknown,
      callback: (error: Error | null) => void,
    ): void => {
      execFileCalls.push({ command, args, options })
      callback(new Error("taskkill failed"))
    },
  }
})

suite("Langs on Windows", function () {
  afterAll(function () {
    Object.defineProperty(process, "platform", platform)
  })

  test("interrupting kills the tree with a hidden taskkill and survives its failure", async function () {
    vi.useFakeTimers()
    try {
      const { default: Langs } = await import("../../api/langs")
      const login = new Langs("dummy-cli-path", "test-client", "1.0.0").authenticate(() => {})

      login.interrupt()
    } finally {
      vi.useRealTimers()
    }

    expect(execFileCalls).toEqual([
      {
        command: "taskkill",
        args: ["/pid", "4242", "/T", "/F"],
        options: { windowsHide: true },
      },
    ])
  })
})
