import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { vi } from "vitest"

import { verifyCliSchema } from "../../init/verifyCliSchema"
import { Logger } from "../../utilities"

// Stands in for `<cli> schema`: either prints a schema or fails the way clap does
// for a subcommand the binary does not know. Mocked rather than faked with a real
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
      callback(new Error("Command failed\nerror: unrecognized subcommand 'schema'"), "")
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

  // The released 0.39.4 the extension pins has no `schema` subcommand, so before
  // this gate the check warned on every single activation about something the
  // user could not act on.
  test("does not warn for a pinned CLI older than the `schema` subcommand", async function () {
    writeVendoredSchema(dir, "{}")

    await verifyCliSchema("fake-cli", dir, "0.39.4")

    expect(warn).not.toHaveBeenCalled()
  })

  test("stays quiet when a CLI claiming support still rejects `schema`", async function () {
    writeVendoredSchema(dir, "{}")

    await verifyCliSchema("fake-cli", dir, "0.40.0")

    expect(warn).not.toHaveBeenCalled()
  })

  test("stays quiet when the schemas match", async function () {
    cli.schema = '{"title":"CliOutput"}'
    writeVendoredSchema(dir, cli.schema)

    await verifyCliSchema("fake-cli", dir, "0.40.0")

    expect(warn).not.toHaveBeenCalled()
  })

  test("warns on a real contract mismatch", async function () {
    cli.schema = '{"title":"CliOutput","x":1}'
    writeVendoredSchema(dir, '{"title":"CliOutput"}')

    await verifyCliSchema("fake-cli", dir, "0.40.0")

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain("output contract mismatch")
  })
})
