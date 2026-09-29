import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { vi } from "vitest"

import { verifyCliSchema } from "../../init/verifyCliSchema"
import { Logger } from "../../utilities"

// Stands in for `<cli> schema`. Mocked rather than faked with a real
// executable, since the unit tier also runs on Windows.
const cli = vi.hoisted(() => ({ schema: undefined as string | undefined }))

vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    if (cli.schema === undefined) {
      callback(new Error("Command failed"), "")
    } else {
      callback(null, cli.schema)
    }
  },
}))

function writeVendoredSchema(extensionPath: string, contents: string): void {
  fs.mkdirSync(path.join(extensionPath, "shared"), { recursive: true })
  fs.writeFileSync(path.join(extensionPath, "shared", "bindings.schema.json"), contents)
}

suite("verifyCliSchema", function () {
  let dir: string
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-cli-schema-"))
    cli.schema = undefined
    warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
    vi.spyOn(Logger, "debug").mockImplementation(() => {})
  })

  afterEach(function () {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("stays quiet when the schemas match", async function () {
    cli.schema = '{"title":"CliOutput"}'
    writeVendoredSchema(dir, cli.schema)

    await verifyCliSchema("fake-cli", dir)

    expect(warn).not.toHaveBeenCalled()
  })

  test("warns on a real contract mismatch", async function () {
    cli.schema = '{"title":"CliOutput","x":1}'
    writeVendoredSchema(dir, '{"title":"CliOutput"}')

    await verifyCliSchema("fake-cli", dir)

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain("output contract mismatch")
  })

  test("warns when the CLI cannot print its schema", async function () {
    writeVendoredSchema(dir, "{}")

    await verifyCliSchema("fake-cli", dir)

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain("Failed to check")
  })
})
