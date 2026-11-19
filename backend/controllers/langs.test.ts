import assert from "node:assert/strict"
import type { Server } from "node:http"
import { after, before, describe, test } from "node:test"

import express from "express"

import langsRouter from "./langs"

describe("CLI download route", () => {
  let server: Server
  let base: string

  before(async () => {
    const app = express()
    app.use("/langs", langsRouter)
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP address")
    }
    base = `http://127.0.0.1:${address.port}`
  })

  after(() => {
    server.close()
  })

  test("an encoded path separator cannot reach outside the CLI directory", async () => {
    const res = await fetch(`${base}/langs/..%2Fpackage.json`)
    assert.equal(res.status, 404)
  })

  test("a missing file is a 404, not a hang", async () => {
    const res = await fetch(`${base}/langs/no-such-cli`, { signal: AbortSignal.timeout(5000) })
    assert.equal(res.status, 404)
  })
})
