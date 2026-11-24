import type * as http from "http"
import * as path from "path"
import * as zlib from "zlib"

import * as fs from "fs-extra"
import * as tmp from "tmp"

import { ConnectionError } from "../../errors"
import { downloadFile } from "../../utilities/utils"
import { serverUrl, startServer } from "./httpServer"

suite("downloadFile", function () {
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

  test("writes the full body to disk before resolving, even when the event loop is then starved", async function () {
    // A tiny body arrives in one chunk, so the write must finish before downloadFile resolves.
    const body = "2a31f5758b4488b279e80e57ff8248aa2485ef80d4cf27618403fb136fc07f71\r\n"
    server = await startServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(Buffer.byteLength(body)),
      })
      res.end(body)
    })
    const out = path.join(tmpDir.name, "x.sha256")

    const result = await downloadFile(serverUrl(server), out)
    // Block the event loop the way the synchronous CLI hashing does.
    const start = Date.now()
    while (Date.now() - start < 200) {
      /* busy-wait */
    }
    const onDisk = fs.readFileSync(out, "utf-8")

    expect(result.ok).toBe(true)
    expect(onDisk).toBe(body)
  })

  test("writes a large multi-chunk body byte-for-byte (backpressure)", async function () {
    const body = Buffer.alloc(8 * 1024 * 1024)
    for (let i = 0; i < body.length; i++) {
      body[i] = i % 256
    }
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(body.length) })
      res.end(body)
    })
    const out = path.join(tmpDir.name, "big.bin")

    const result = await downloadFile(serverUrl(server), out)

    expect(result.ok).toBe(true)
    const onDisk = fs.readFileSync(out)
    expect(onDisk.length).toBe(body.length)
    expect(onDisk.equals(body)).toBe(true)
  })

  test("reports monotonic progress up to 100", async function () {
    const body = Buffer.alloc(2 * 1024 * 1024, 7)
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(body.length) })
      res.end(body)
    })
    const out = path.join(tmpDir.name, "prog.bin")
    const percents: number[] = []

    const result = await downloadFile(serverUrl(server), out, {
      onProgress: (percent) => percents.push(percent),
    })

    expect(result.ok).toBe(true)
    expect(percents.length).toBeGreaterThan(0)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1] ?? 0)
    }
    expect(percents[percents.length - 1]).toBe(100)
  })

  test("releases the file handle so the directory can be removed immediately", async function () {
    const body = "small"
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(body.length) })
      res.end(body)
    })
    const out = path.join(tmpDir.name, "sub", "f.txt")

    await downloadFile(serverUrl(server), out)
    // No open fd should remain; on Windows a leftover handle throws ENOTEMPTY.
    expect(() => fs.rmSync(path.join(tmpDir.name, "sub"), { recursive: true })).not.toThrow()
  })

  test("returns an Err when the file cannot be written", async function () {
    const body = Buffer.alloc(1024 * 1024, 7)
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(body.length) })
      res.end(body)
    })
    // A directory where the file should go fails the write once the body starts arriving.
    const out = path.join(tmpDir.name, "occupied")
    fs.mkdirSync(out)

    const result = await downloadFile(serverUrl(server), out)

    expect(result.err).toBe(true)
  })

  // `Content-Length` counts the compressed bytes, and fetch hands back the decompressed ones.
  test("accepts a compressed body longer than the length it declares", async function () {
    const body = Buffer.alloc(64 * 1024, "a")
    const compressed = zlib.gzipSync(body)
    server = await startServer((_req, res) => {
      res.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
      })
      res.end(compressed)
    })
    const out = path.join(tmpDir.name, "compressed.bin")

    const result = await downloadFile(serverUrl(server), out)

    expect(result.ok).toBe(true)
    expect(fs.readFileSync(out).equals(body)).toBe(true)
  })

  test("returns Err with 'Request failed' on a non-2xx response", async function () {
    server = await startServer((_req, res) => {
      res.writeHead(404)
      res.end("nope")
    })
    const out = path.join(tmpDir.name, "missing")

    const result = await downloadFile(serverUrl(server), out)

    expect(result.err).toBe(true)
    if (result.err) {
      expect(result.val.message).toContain("Request failed")
    }
  })

  test("returns a ConnectionError when the host is unreachable", async function () {
    const dead = await startServer(() => {})
    const deadUrl = serverUrl(dead)
    await new Promise<void>((resolve) => {
      dead.close(() => resolve())
    })
    const out = path.join(tmpDir.name, "unreachable")

    const result = await downloadFile(deadUrl, out)

    expect(result.err).toBe(true)
    if (result.err) {
      expect(result.val).toBeInstanceOf(ConnectionError)
    }
  })

  test("returns an Err (does not throw) when the output directory cannot be created", async function () {
    // A regular file as a parent path component fails directory creation before any request.

    const blocker = path.join(tmpDir.name, "blocker")
    fs.writeFileSync(blocker, "i am a file, not a directory")
    const out = path.join(blocker, "child", "f.txt")

    let result: Awaited<ReturnType<typeof downloadFile>> | undefined
    let threw = false
    try {
      result = await downloadFile("http://127.0.0.1:9/never-reached", out)
    } catch (_e) {
      threw = true
    }

    expect(threw, "downloadFile should not throw").toBe(false)
    expect(result?.err).toBe(true)
  })

  test("returns Err within the stall budget when the server sends headers and then nothing", async function () {
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" })
      // Deliberately never writes a byte and never ends the response.
    })
    const out = path.join(tmpDir.name, "stalled.bin")

    const started = Date.now()
    const result = await downloadFile(serverUrl(server), out, { stallTimeoutMs: 200 })

    expect(result.err).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test("returns Err when the body stops short of its declared content-length", async function () {
    const declared = 4096
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(declared) })
      res.end(Buffer.alloc(declared / 2, 1))
    })
    const out = path.join(tmpDir.name, "short.bin")

    const result = await downloadFile(serverUrl(server), out, { stallTimeoutMs: 1000 })

    expect(result.err).toBe(true)
  })

  test("returns Err when the caller's signal aborts mid-download", async function () {
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(64 * 1024 * 1024) })
      res.write(Buffer.alloc(1024))
      // Leaves the rest undelivered so the abort, not the body, ends the download.
    })
    const out = path.join(tmpDir.name, "aborted.bin")
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)

    const result = await downloadFile(serverUrl(server), out, {
      signal: controller.signal,
      stallTimeoutMs: 10_000,
    })

    expect(result.err).toBe(true)
  })

  test("has no total time budget by default: a slow but steady body completes", async function () {
    const body = Buffer.alloc(3000, 7)
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": String(body.length) })
      let sent = 0
      const timer = setInterval(() => {
        res.write(body.subarray(sent, sent + 1000))
        sent += 1000
        if (sent >= body.length) {
          clearInterval(timer)
          res.end()
        }
      }, 150)
    })
    const out = path.join(tmpDir.name, "slow.bin")

    const result = await downloadFile(serverUrl(server), out, { stallTimeoutMs: 1000 })

    expect(result.ok).toBe(true)
    expect(fs.readFileSync(out).equals(body)).toBe(true)
  })

  test("an explicit total budget still ends a download that keeps trickling", async function () {
    server = await startServer((_req, res) => {
      res.writeHead(200, { "content-length": "100000" })
      setInterval(() => res.write("x"), 50).unref()
    })
    const out = path.join(tmpDir.name, "trickle.bin")

    const result = await downloadFile(serverUrl(server), out, {
      stallTimeoutMs: 1000,
      totalTimeoutMs: 300,
    })

    expect(result.err).toBe(true)
  })

  suite("resume", function () {
    const body = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))

    /** Serves `body`, honouring a Range request when `honourRange`. */
    async function serveWithRange(honourRange: boolean): Promise<string[]> {
      const ranges: string[] = []
      server = await startServer((req, res) => {
        const range = req.headers.range
        ranges.push(range ?? "")
        const start = honourRange && range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0
        if (start > 0) {
          res.writeHead(206, {
            "content-length": String(body.length - start),
            "content-range": `bytes ${start}-${body.length - 1}/${body.length}`,
          })
          res.end(body.subarray(start))
        } else {
          res.writeHead(200, { "content-length": String(body.length) })
          res.end(body)
        }
      })
      return ranges
    }

    test("continues a partial file with a Range request", async function () {
      const ranges = await serveWithRange(true)
      const out = path.join(tmpDir.name, "partial.bin")
      fs.writeFileSync(out, body.subarray(0, 2000))
      const progress: number[] = []

      const result = await downloadFile(serverUrl(server as http.Server), out, {
        resume: true,
        onProgress: (percent) => progress.push(percent),
      })

      expect(result.ok).toBe(true)
      expect(ranges).toEqual(["bytes=2000-"])
      expect(fs.readFileSync(out).equals(body)).toBe(true)
      expect(progress.at(-1)).toBe(100)
    })

    test("starts over when the server ignores the range and sends everything", async function () {
      await serveWithRange(false)
      const out = path.join(tmpDir.name, "partial.bin")
      fs.writeFileSync(out, Buffer.alloc(2000, 9))

      const result = await downloadFile(serverUrl(server as http.Server), out, { resume: true })

      expect(result.ok).toBe(true)
      expect(fs.readFileSync(out).equals(body)).toBe(true)
    })

    test("sends no Range for a file that does not exist yet, or without the option", async function () {
      const ranges = await serveWithRange(true)
      const out = path.join(tmpDir.name, "fresh.bin")
      await downloadFile(serverUrl(server as http.Server), out, { resume: true })
      fs.writeFileSync(out, "stale")
      await downloadFile(serverUrl(server as http.Server), out)

      expect(ranges).toEqual(["", ""])
      expect(fs.readFileSync(out).equals(body)).toBe(true)
    })

    test("drops a partial file the server cannot resume, so the next attempt starts over", async function () {
      server = await startServer((_req, res) => {
        res.writeHead(416)
        res.end()
      })
      const out = path.join(tmpDir.name, "partial.bin")
      fs.writeFileSync(out, "partial")

      const result = await downloadFile(serverUrl(server), out, { resume: true })

      expect(result.err).toBe(true)
      expect(fs.existsSync(out)).toBe(false)
    })
  })
})
