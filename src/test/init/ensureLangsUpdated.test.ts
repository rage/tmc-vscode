import * as crypto from "crypto"
import type * as http from "http"
import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"

import type Dialog from "../../api/dialog"
import { CliVerificationError, InitializationError } from "../../errors"
import {
  ensureLangsUpdated,
  parseSha256Sum,
  removeStaleCliFiles,
  verifyCli,
} from "../../init/ensureLangsUpdated"
import { getLangsCLIForPlatform, getPlatform } from "../../utilities"
import { createDialogMock } from "../mocks/dialog"
import { serverUrl, startServer } from "../utils/httpServer"

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

interface ServeState {
  cli: Buffer
  // Returns the full `.sha256` file body for the n-th sha request (1-indexed).
  shaFor: (hit: number) => string
  hits: { cli: number; sha: number }
}

/** A Dialog whose progress notification cancels itself after `afterMs`. */
function cancellingDialog(afterMs: number): Dialog {
  return {
    progressNotification: async (
      _message: string,
      task: (progress: unknown, token: unknown) => unknown,
    ) => {
      const listeners: (() => void)[] = []
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
          listeners.push(listener)
          return { dispose: (): void => {} }
        },
      }
      setTimeout(() => {
        token.isCancellationRequested = true
        for (const listener of listeners) {
          listener()
        }
      }, afterMs)
      return await task({ report: (): void => {} }, token)
    },
  } as unknown as Dialog
}

function startLangsServer(state: ServeState): Promise<http.Server> {
  return startServer((req, res) => {
    if ((req.url ?? "").endsWith(".sha256")) {
      state.hits.sha++
      const body = state.shaFor(state.hits.sha)
      res.writeHead(200, { "content-length": String(Buffer.byteLength(body)) })
      res.end(body)
    } else {
      state.hits.cli++
      res.writeHead(200, { "content-length": String(state.cli.length) })
      res.end(state.cli)
    }
  })
}

suite("ensureLangsUpdated checksum parsing", function () {
  const lowerHash = "2a31f5758b4488b279e80e57ff8248aa2485ef80d4cf27618403fb136fc07f71"
  const upperHash = lowerHash.toUpperCase()

  test("normalizes an uppercase .sha256 hash to lowercase", function () {
    // An uppercase hash from the server must still match, or every startup redownloads.
    expect(parseSha256Sum(`${upperHash}  tmc-langs-cli`)).toBe(lowerHash)
  })

  test("leaves a lowercase hash unchanged", function () {
    expect(parseSha256Sum(`${lowerHash}  tmc-langs-cli`)).toBe(lowerHash)
  })

  test("strips trailing whitespace/newline", function () {
    expect(parseSha256Sum(`${lowerHash}\n`)).toBe(lowerHash)
  })

  test("handles a bare uppercase hash with CRLF and no filename", function () {
    expect(parseSha256Sum(`${upperHash}\r\n`)).toBe(lowerHash)
  })

  test("tolerates leading whitespace and tab separators", function () {
    expect(parseSha256Sum(`   ${lowerHash}\ttmc-langs-cli`)).toBe(lowerHash)
  })

  test("returns empty string for empty or whitespace-only content", function () {
    expect(parseSha256Sum("")).toBe("")
    expect(parseSha256Sum("   \r\n  ")).toBe("")
  })
})

suite("verifyCli", function () {
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })
  afterEach(function () {
    tmpDir.removeCallback()
  })

  function write(cli: Buffer, shaBody: string): { cliPath: string; shaPath: string } {
    const cliPath = path.join(tmpDir.name, "cli")
    const shaPath = cliPath + ".sha256"
    fs.writeFileSync(cliPath, cli)
    fs.writeFileSync(shaPath, shaBody)
    return { cliPath, shaPath }
  }

  test("matches when the checksum is correct", async function () {
    const cli = Buffer.from("hello cli")
    const { cliPath, shaPath } = write(cli, `${sha256(cli)}  cli`)
    const result = await verifyCli(cliPath, shaPath)
    expect(result.match).toBe(true)
    expect(result.cliDigest).toBe(sha256(cli))
  })

  test("matches case-insensitively against an uppercase checksum", async function () {
    const cli = Buffer.from("hello cli")
    const { cliPath, shaPath } = write(cli, `${sha256(cli).toUpperCase()}\r\n`)
    expect((await verifyCli(cliPath, shaPath)).match).toBe(true)
  })

  test("does not match a wrong checksum but still reports both digests", async function () {
    const cli = Buffer.from("hello cli")
    const wrong = sha256(Buffer.from("other"))
    const { cliPath, shaPath } = write(cli, `${wrong}  cli`)
    const result = await verifyCli(cliPath, shaPath)
    expect(result.match).toBe(false)
    expect(result.cliDigest).toBe(sha256(cli))
    expect(result.hashData).toBe(wrong)
  })

  test("does not match (and does not throw) on an empty checksum file", async function () {
    const cli = Buffer.from("hello cli")
    const { cliPath, shaPath } = write(cli, "")
    const result = await verifyCli(cliPath, shaPath)
    expect(result.match).toBe(false)
    expect(result.hashData).toBe("")
  })

  test("does not match (and does not throw) when the checksum file is missing", async function () {
    const cli = Buffer.from("hello cli")
    const cliPath = path.join(tmpDir.name, "cli")
    fs.writeFileSync(cliPath, cli)
    const result = await verifyCli(cliPath, cliPath + ".sha256")
    expect(result.match).toBe(false)
    expect(result.cliDigest).toBe(sha256(cli))
    expect(result.hashData).toBe("")
  })

  test("does not match (and does not throw) when the CLI file is missing", async function () {
    const shaPath = path.join(tmpDir.name, "cli.sha256")
    fs.writeFileSync(shaPath, `${sha256(Buffer.from("anything"))}  cli`)
    const result = await verifyCli(path.join(tmpDir.name, "cli"), shaPath)
    expect(result.match).toBe(false)
    expect(result.cliDigest).toBe("")
  })

  test("does not match two unreadable files as equal", async function () {
    // Both files missing -> both digests "" -> must NOT report a match.
    const result = await verifyCli(
      path.join(tmpDir.name, "missing-cli"),
      path.join(tmpDir.name, "missing-cli.sha256"),
    )
    expect(result.match).toBe(false)
  })
})

const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 60 * 60 * 1000)

suite("removeStaleCliFiles", function () {
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })
  afterEach(function () {
    tmpDir.removeCallback()
  })

  test("does nothing for a folder that does not exist", async function () {
    await removeStaleCliFiles(path.join(tmpDir.name, "does-not-exist"), [])
  })

  test("removes abandoned downloads and all but the newest other version", async function () {
    const folder = tmpDir.name
    const names = [
      "tmc-langs-cli-3",
      "tmc-langs-cli-3.sha256",
      "tmc-langs-cli-2",
      "tmc-langs-cli-2.sha256",
      "tmc-langs-cli-2.verified",
      "tmc-langs-cli-1",
      "tmc-langs-cli-1.sha256",
      "temp-old-cli",
      "temp-new-cli",
    ]
    for (const name of names) {
      fs.outputFileSync(path.join(folder, name), "data")
    }
    fs.utimesSync(path.join(folder, "temp-old-cli"), hoursAgo(24), hoursAgo(24))
    fs.utimesSync(path.join(folder, "tmc-langs-cli-2"), hoursAgo(48), hoursAgo(48))
    fs.utimesSync(path.join(folder, "tmc-langs-cli-1"), hoursAgo(96), hoursAgo(96))

    await removeStaleCliFiles(folder, ["tmc-langs-cli-3", "tmc-langs-cli-3.sha256"])

    expect(fs.readdirSync(folder).toSorted()).toEqual([
      "temp-new-cli",
      "tmc-langs-cli-2",
      "tmc-langs-cli-2.sha256",
      "tmc-langs-cli-2.verified",
      "tmc-langs-cli-3",
      "tmc-langs-cli-3.sha256",
    ])
  })
})

suite("ensureLangsUpdated end-to-end", function () {
  const version = "0.0.0-test"
  const executable = getLangsCLIForPlatform(getPlatform(), version)

  let server: http.Server | undefined
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })

  afterEach(function () {
    tmpDir.removeCallback()
    if (server) {
      const s = server
      server = undefined
      return new Promise<void>((resolve) => {
        s.close(() => resolve())
      })
    }
    return undefined
  })

  test("fresh install downloads, verifies, and does not double-download", async function () {
    const cli = Buffer.from("fake cli binary contents")
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    const cliPath = result.unwrap()
    expect(fs.existsSync(cliPath)).toBe(true)
    expect(fs.readFileSync(cliPath + ".sha256", "utf-8").length).toBeGreaterThan(0)
    expect((await verifyCli(cliPath, cliPath + ".sha256")).match).toBe(true)
    // A correct first download must not trigger a redownload.
    expect(state.hits.cli).toBe(1)
  })

  // Two windows activating at once install into the same folder.
  test("two installs at once both end up with a verified CLI", async function () {
    const cli = Buffer.from("fake cli binary contents")
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const folder = path.join(tmpDir.name, "cli")
    const install = (): ReturnType<typeof ensureLangsUpdated> =>
      ensureLangsUpdated(folder, createDialogMock()[0], {
        downloadUrl: serverUrl(server!),
        version,
      })

    const results = await Promise.all([install(), install()])

    expect(results.map((result) => result.ok)).toEqual([true, true])
    const cliPath = path.join(folder, executable)
    expect((await verifyCli(cliPath, cliPath + ".sha256")).match).toBe(true)
  })

  test("keeps the previous version for windows still running it", async function () {
    const cli = Buffer.from("fake cli binary contents")
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const folder = path.join(tmpDir.name, "cli")
    fs.outputFileSync(path.join(folder, "tmc-langs-cli-0.0.0-older"), "old")
    fs.outputFileSync(path.join(folder, "tmc-langs-cli-0.0.0-oldest"), "older")
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    fs.utimesSync(path.join(folder, "tmc-langs-cli-0.0.0-oldest"), longAgo, longAgo)

    const result = await ensureLangsUpdated(folder, createDialogMock()[0], {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    expect(fs.readdirSync(folder).toSorted()).toEqual(
      [
        executable,
        `${executable}.sha256`,
        `${executable}.verified`,
        "tmc-langs-cli-0.0.0-older",
      ].toSorted(),
    )
  })

  test("fresh install accepts an uppercase + CRLF checksum on the first try", async function () {
    const cli = Buffer.from("fake cli binary contents")
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli).toUpperCase()}\r\n`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    expect(state.hits.cli).toBe(1)
    expect(state.hits.sha).toBe(1)
  })

  test("a persistently corrupt download fails closed with an Err (never throws)", async function () {
    const cli = Buffer.from("the real bytes")
    const wrong = sha256(Buffer.from("different bytes"))
    const state: ServeState = {
      cli,
      shaFor: () => `${wrong}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.err).toBe(true)
    if (result.err) {
      expect(result.val).toBeInstanceOf(InitializationError)
    }
    // initial download + one redownload attempt
    expect(state.hits.cli).toBe(2)
  })

  test("recovers when the redownload yields a matching checksum", async function () {
    const cli = Buffer.from("real bytes v2")
    const wrong = sha256(Buffer.from("nope"))
    const state: ServeState = {
      cli,
      // first checksum served is wrong, the redownload's is correct
      shaFor: (hit) => (hit === 1 ? `${wrong}  ${executable}` : `${sha256(cli)}  ${executable}`),
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    const cliPath = result.unwrap()
    expect((await verifyCli(cliPath, cliPath + ".sha256")).match).toBe(true)
    expect(state.hits.cli).toBe(2)
  })

  test("a failed download returns an Err and never throws", async function () {
    const dead = await startLangsServer({
      cli: Buffer.alloc(0),
      shaFor: () => "",
      hits: { cli: 0, sha: 0 },
    })
    const deadUrl = serverUrl(dead)
    await new Promise<void>((resolve) => {
      dead.close(() => resolve())
    })
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: deadUrl,
      version,
    })

    expect(result.err).toBe(true)
  })

  test("a damaged CLI on disk that cannot be downloaded again names the file", async function () {
    const folder = path.join(tmpDir.name, "cli")
    const cliPath = path.join(folder, executable)
    fs.outputFileSync(cliPath, "overwritten bytes")
    fs.outputFileSync(cliPath + ".sha256", sha256(Buffer.from("original bytes")))
    const dead = await startLangsServer({
      cli: Buffer.alloc(0),
      shaFor: () => "",
      hits: { cli: 0, sha: 0 },
    })
    const deadUrl = serverUrl(dead)
    await new Promise<void>((resolve) => {
      dead.close(() => resolve())
    })
    const [dialog] = createDialogMock()

    const result = await ensureLangsUpdated(folder, dialog, { downloadUrl: deadUrl, version })

    expect(result.val).toBeInstanceOf(CliVerificationError)
    expect(result.val).toMatchObject({ cliPath })
    expect((result.val as Error).message).toMatch(/^The TestMyCode tools on this computer failed/)
  })

  test("a valid cache with an uppercase checksum is accepted without any download", async function () {
    const cli = Buffer.from("cached cli bytes")
    const folder = path.join(tmpDir.name, "cli")
    fs.outputFileSync(path.join(folder, executable), cli)
    // Uppercase + CRLF, exactly the on-disk form 3.5.1 redownloaded on every startup.
    fs.outputFileSync(path.join(folder, executable + ".sha256"), `${sha256(cli).toUpperCase()}\r\n`)
    const state: ServeState = {
      cli: Buffer.from("SHOULD NOT BE SERVED"),
      shaFor: () => "SHOULD-NOT-BE-HIT",
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    expect(state.hits.cli).toBe(0)
    expect(state.hits.sha).toBe(0)
  })

  test("leaves no partial checksum behind: the .sha256 appears only once complete", async function () {
    const cli = Buffer.from("fake cli binary contents")
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    expect(fs.readdirSync(folder).filter((x) => x.endsWith(".tmp"))).toEqual([])
  })

  test("retries a failing CLI download before giving up", async function () {
    const cli = Buffer.from("eventually served")
    let cliAttempts = 0
    server = await startServer((req, res) => {
      if ((req.url ?? "").endsWith(".sha256")) {
        const body = `${sha256(cli)}  ${executable}`
        res.writeHead(200, { "content-length": String(Buffer.byteLength(body)) })
        res.end(body)
        return
      }
      cliAttempts++
      if (cliAttempts === 1) {
        res.writeHead(503)
        res.end("try again")
        return
      }
      res.writeHead(200, { "content-length": String(cli.length) })
      res.end(cli)
    })
    const [dialog] = createDialogMock()
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    expect(cliAttempts).toBe(2)
  })

  test("a cancelled download is not retried", async function () {
    let cliAttempts = 0
    server = await startServer((req, res) => {
      if ((req.url ?? "").endsWith(".sha256")) {
        res.writeHead(200, { "content-length": "0" })
        res.end()
        return
      }
      cliAttempts++
      res.writeHead(200, { "content-length": String(64 * 1024 * 1024) })
      res.write(Buffer.alloc(1024))
      // Never finishes, so only the cancellation can end the download.
    })

    const result = await ensureLangsUpdated(path.join(tmpDir.name, "cli"), cancellingDialog(50), {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.err).toBe(true)
    expect(cliAttempts).toBe(1)
  })

  test("a cached CLI whose checksum file is missing recovers via redownload instead of throwing", async function () {
    // Simulates a prior run that downloaded+renamed the CLI but failed to
    // write its .sha256: the binary exists on disk, the checksum does not.
    const cli = Buffer.from("cached cli with no checksum file")
    const folder = path.join(tmpDir.name, "cli")
    fs.outputFileSync(path.join(folder, executable), cli)
    const state: ServeState = {
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    const [dialog] = createDialogMock()

    const result = await ensureLangsUpdated(folder, dialog, {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.ok).toBe(true)
    const cliPath = result.unwrap()
    expect((await verifyCli(cliPath, cliPath + ".sha256")).match).toBe(true)
    // The missing checksum forced a single redownload rather than a crash.
    expect(state.hits.cli).toBe(1)
    expect(state.hits.sha).toBe(1)
  })
})

suite("ensureLangsUpdated on an unsupported platform", function () {
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })

  afterEach(function () {
    tmpDir.removeCallback()
    vi.doUnmock("../../utilities/env")
    vi.resetModules()
  })

  test("names the platform instead of downloading a binary that cannot run", async function () {
    vi.resetModules()
    vi.doMock("../../utilities/env", () => ({
      getAllLangsCLIs: () => [],
      getPlatform: () => "unsupported",
      getLangsCLIForPlatform: () => {
        throw new Error("no build")
      },
    }))
    const unsupported = await import("../../init/ensureLangsUpdated")
    // Same fresh module registry, so the error class compares by identity.
    const { InitializationError: FreshInitializationError } = await import("../../errors")
    const [dialog] = createDialogMock()

    const result = await unsupported.ensureLangsUpdated(path.join(tmpDir.name, "cli"), dialog, {
      downloadUrl: "http://127.0.0.1:9/never-reached/",
      version: "0.0.0-test",
    })

    expect(result.err).toBe(true)
    if (result.err) {
      expect(result.val).toBeInstanceOf(FreshInitializationError)
      expect(result.val.message).toContain(process.platform)
      expect(result.val.message).toContain(process.arch)
    }
  })
})

suite("ensureLangsUpdated against the built-in checksums", function () {
  const version = "0.0.0-test"
  const executable = getLangsCLIForPlatform(getPlatform(), version)
  const cli = Buffer.from("fake cli binary contents")

  let server: http.Server | undefined
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })

  afterEach(function () {
    tmpDir.removeCallback()
    const s = server
    server = undefined
    return s
      ? new Promise<void>((resolve) => {
          s.close(() => resolve())
        })
      : undefined
  })

  async function serve(served: Buffer, remoteSha: string): Promise<ServeState> {
    const state: ServeState = {
      cli: served,
      shaFor: () => `${remoteSha}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    }
    server = await startLangsServer(state)
    return state
  }

  test("accepts a download that matches the built-in checksum", async function () {
    await serve(cli, sha256(cli))
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, createDialogMock()[0], {
      downloadUrl: serverUrl(server as http.Server),
      version,
      builtInChecksums: { [executable]: sha256(cli) },
    })

    expect(result.ok).toBe(true)
  })

  test("rejects a substituted binary even though the server's own checksum agrees with it", async function () {
    const substitute = Buffer.from("not the build we released")
    await serve(substitute, sha256(substitute))

    const result = await ensureLangsUpdated(path.join(tmpDir.name, "cli"), createDialogMock()[0], {
      downloadUrl: serverUrl(server as http.Server),
      version,
      builtInChecksums: { [executable]: sha256(cli) },
    })

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(InitializationError)
  })

  test("fails loudly when the table has no entry for this platform", async function () {
    const state = await serve(cli, sha256(cli))

    const result = await ensureLangsUpdated(path.join(tmpDir.name, "cli"), createDialogMock()[0], {
      downloadUrl: serverUrl(server as http.Server),
      version,
      builtInChecksums: { "tmc-langs-cli-some-other-platform": sha256(cli) },
    })

    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("no built-in checksum")
    expect(state.hits.cli).toBe(0)
  })

  suite("with testMyCode.cliPath", function () {
    test("uses a CLI that matches the built-in checksum and downloads nothing", async function () {
      const state = await serve(cli, sha256(cli))
      const own = path.join(tmpDir.name, "installed-by-admin")
      fs.writeFileSync(own, cli)

      const result = await ensureLangsUpdated(
        path.join(tmpDir.name, "cli"),
        createDialogMock()[0],
        {
          downloadUrl: serverUrl(server as http.Server),
          version,
          builtInChecksums: { [executable]: sha256(cli) },
          cliPath: own,
        },
      )

      expect(result.val).toBe(own)
      expect(state.hits.cli).toBe(0)
    })

    test("rejects a CLI of another build", async function () {
      const own = path.join(tmpDir.name, "installed-by-admin")
      fs.writeFileSync(own, "an older build")

      const result = await ensureLangsUpdated(
        path.join(tmpDir.name, "cli"),
        createDialogMock()[0],
        {
          downloadUrl: "http://127.0.0.1:9/",
          version,
          builtInChecksums: { [executable]: sha256(cli) },
          cliPath: own,
        },
      )

      expect(result.err).toBe(true)
      expect((result.val as Error).message).toContain(`is not ${executable}`)
    })

    test("reports a missing file instead of downloading", async function () {
      const missing = path.join(tmpDir.name, "nowhere")

      const result = await ensureLangsUpdated(
        path.join(tmpDir.name, "cli"),
        createDialogMock()[0],
        {
          downloadUrl: "http://127.0.0.1:9/",
          version,
          cliPath: missing,
        },
      )

      expect(result.err).toBe(true)
      expect((result.val as Error).message).toContain("does not exist")
    })
  })
})

suite("ensureLangsUpdated install hygiene", function () {
  const version = "0.0.0-test"
  const executable = getLangsCLIForPlatform(getPlatform(), version)

  let server: http.Server | undefined
  let tmpDir: tmp.DirResult

  beforeEach(function () {
    tmpDir = tmp.dirSync({ unsafeCleanup: true })
  })

  afterEach(function () {
    tmpDir.removeCallback()
    const s = server
    server = undefined
    return s
      ? new Promise<void>((resolve) => {
          s.close(() => resolve())
        })
      : undefined
  })

  test("leaves no partial download behind when every attempt fails", async function () {
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": "1000" })
      res.write("partial")
      res.destroy()
    })
    const folder = path.join(tmpDir.name, "cli")

    const result = await ensureLangsUpdated(folder, createDialogMock()[0], {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(result.err).toBe(true)
    expect(fs.readdirSync(folder)).toEqual([])
  })

  test("sweeps a download abandoned by an earlier run at the start", async function () {
    const cli = Buffer.from("fake cli binary contents")
    server = await startLangsServer({
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    })
    const folder = path.join(tmpDir.name, "cli")
    const abandoned = path.join(folder, `temp-dead-${executable}`)
    fs.outputFileSync(abandoned, "half")
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    fs.utimesSync(abandoned, longAgo, longAgo)

    await ensureLangsUpdated(folder, createDialogMock()[0], {
      downloadUrl: serverUrl(server),
      version,
    })

    expect(fs.existsSync(abandoned)).toBe(false)
  })

  test("does not hash the CLI again while its size and mtime are those it was verified at", async function () {
    const cli = Buffer.from("fake cli binary contents")
    server = await startLangsServer({
      cli,
      shaFor: () => `${sha256(cli)}  ${executable}`,
      hits: { cli: 0, sha: 0 },
    })
    const folder = path.join(tmpDir.name, "cli")
    const config = { downloadUrl: serverUrl(server), version }
    await ensureLangsUpdated(folder, createDialogMock()[0], config)
    const cliPath = path.join(folder, executable)

    // Same size and mtime, different bytes: only a skipped hash still matches.
    const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
    fs.utimesSync(cliPath, mtime, mtime)
    expect((await verifyCli(cliPath, `${cliPath}.sha256`)).match).toBe(true)
    fs.writeFileSync(cliPath, Buffer.alloc(cli.length, "x"))
    fs.utimesSync(cliPath, mtime, mtime)
    const trusting = await verifyCli(cliPath, `${cliPath}.sha256`)
    expect(trusting.match).toBe(true)

    // A touched file is hashed, and fails.
    const later = new Date(mtime.getTime() + 5000)
    fs.utimesSync(cliPath, later, later)
    const rehashed = await verifyCli(cliPath, `${cliPath}.sha256`)
    expect(rehashed.match).toBe(false)
  })

  test("does not set the executable bit on Windows, where a scanner can hold the new file", async function () {
    const winExecutable = getLangsCLIForPlatform("windows64", version)
    const cli = Buffer.from("fake cli binary contents")
    server = await startServer((req, res) => {
      const body = (req.url ?? "").endsWith(".sha256") ? `${sha256(cli)}  ${winExecutable}` : cli
      res.writeHead(200, { "content-length": String(Buffer.byteLength(body)) })
      res.end(body)
    })
    const platform = Object.getOwnPropertyDescriptor(process, "platform")
    const arch = Object.getOwnPropertyDescriptor(process, "arch")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    Object.defineProperty(process, "arch", { value: "x64", configurable: true })
    try {
      const folder = path.join(tmpDir.name, "cli")
      const result = await ensureLangsUpdated(folder, createDialogMock()[0], {
        downloadUrl: serverUrl(server),
        version,
      })

      expect(result.ok).toBe(true)
      expect(fs.statSync(path.join(folder, winExecutable)).mode & 0o111).toBe(0)
    } finally {
      Object.defineProperty(process, "platform", platform as PropertyDescriptor)
      Object.defineProperty(process, "arch", arch as PropertyDescriptor)
    }
  })

  test("warns Java students on musl that Java exercises cannot run", async function () {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")
    const arch = Object.getOwnPropertyDescriptor(process, "arch")
    const report = Object.getOwnPropertyDescriptor(process, "report")
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    Object.defineProperty(process, "arch", { value: "x64", configurable: true })
    Object.defineProperty(process, "report", {
      value: { getReport: () => ({ header: {} }) },
      configurable: true,
    })
    const [dialog] = createDialogMock()
    try {
      await ensureLangsUpdated(path.join(tmpDir.name, "cli"), dialog, {
        downloadUrl: "http://127.0.0.1:9/",
        version,
        cliPath: path.join(tmpDir.name, "unused"),
      })
      expect(dialog.warningNotification).not.toHaveBeenCalled()

      await ensureLangsUpdated(path.join(tmpDir.name, "cli"), dialog, {
        downloadUrl: "http://127.0.0.1:9/",
        version,
      })

      expect(dialog.warningNotification).toHaveBeenCalledWith(
        expect.stringContaining("Java exercises cannot be run"),
      )
    } finally {
      Object.defineProperty(process, "platform", platform as PropertyDescriptor)
      Object.defineProperty(process, "arch", arch as PropertyDescriptor)
      Object.defineProperty(process, "report", report as PropertyDescriptor)
    }
  })
})
