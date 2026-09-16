import type { LangsSchemaFailure, LangsStdoutEvent } from "../../api/langs"
import { decodeLangsStdout } from "../../api/langs"

const TOKEN = "super-secret-refresh-token"

const outputDataLine = JSON.stringify({
  "output-kind": "output-data",
  status: "finished",
  message: "logged in",
  result: "logged-in",
  data: { "output-data-kind": "config-value", "output-data": "/projects/dir" },
})

const statusUpdateLine = JSON.stringify({
  "output-kind": "status-update",
  "update-data-kind": "none",
  finished: false,
  message: "Working",
  "percent-done": 0.25,
  time: 1234,
  data: null,
})

const notificationLine = JSON.stringify({
  "output-kind": "notification",
  "notification-kind": "warning",
  message: "Your Python version is outdated",
})

// A login envelope carrying a live token, rejected because `status` drifted to a value
// the contract does not know. This is the line that must not reach the output channel.
const driftedTokenLine = JSON.stringify({
  "output-kind": "output-data",
  status: "aborted",
  message: "logged in",
  result: "logged-in",
  data: {
    "output-data-kind": "token",
    "output-data": { access_token: TOKEN, refresh_token: TOKEN, expires_in: 3600 },
  },
})

/** Feeds the chunks in order, threading the carry the way `_spawnLangsProcess` does. */
function decodeAll(...chunks: string[]): { carry: string; events: LangsStdoutEvent[] } {
  let carry = ""
  const events: LangsStdoutEvent[] = []
  for (const chunk of chunks) {
    const decoded = decodeLangsStdout(carry, chunk)
    carry = decoded.carry
    events.push(...decoded.events)
  }
  return { carry, events }
}

function onlyFailure(events: LangsStdoutEvent[]): LangsSchemaFailure {
  const failures = events.flatMap((event) =>
    event.kind === "schema-mismatch" ? [event.failure] : [],
  )
  expect(failures).toHaveLength(1)
  return failures[0] as LangsSchemaFailure
}

suite("Langs stdout decoding", function () {
  test("a line split across chunks is decoded once it completes", function () {
    const half = Math.floor(outputDataLine.length / 2)
    const { carry, events } = decodeAll(
      outputDataLine.slice(0, half),
      outputDataLine.slice(half) + "\n",
    )
    expect(carry).toBe("")
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe("output-data")
  })

  test("two objects in one chunk are decoded as two events", function () {
    const { events } = decodeAll(`${outputDataLine}\n${statusUpdateLine}\n`)
    expect(events.map((event) => event.kind)).toEqual(["output-data", "status-update"])
  })

  test("an unterminated tail is returned as carry rather than decoded", function () {
    const { carry, events } = decodeAll(`${statusUpdateLine}\n{"output-kind":"outp`)
    expect(events.map((event) => event.kind)).toEqual(["status-update"])
    expect(carry).toBe('{"output-kind":"outp')
  })

  test("blank lines and carriage returns are ignored", function () {
    const { events } = decodeAll(`\n  \n${notificationLine}\r\n`)
    expect(events.map((event) => event.kind)).toEqual(["notification"])
  })

  test("a line that is not JSON reports only its length", function () {
    const { events } = decodeAll(`thread 'main' panicked at ${TOKEN}\n`)
    expect(events).toEqual([{ kind: "unparseable", lineLength: 26 + TOKEN.length }])
  })

  test("a line the CLI contract rejects is reported as a schema mismatch", function () {
    const { events } = decodeAll(`${driftedTokenLine}\n`)
    const failure = onlyFailure(events)
    expect(failure.outputKind).toBe("output-data")
    expect(failure.issueSummary.length).toBeGreaterThan(0)
  })

  test("a rejected line's description carries key names but no values", function () {
    const { events } = decodeAll(`${driftedTokenLine}\n`)
    const failure = onlyFailure(events)
    const described = JSON.stringify(failure)
    expect(described).not.toContain(TOKEN)
    expect(described).not.toContain("3600")
    expect(described).toContain("refresh_token")
    expect(described).toContain("access_token")
    // A drift report that cannot name the variant is useless, and these are contract
    // discriminators rather than anything the user or the backend supplied.
    expect(described).toContain("logged-in")
    expect(described).toContain("token")
  })

  test("a drifted status update is rejected rather than passed on", function () {
    const drifted = JSON.stringify({
      "output-kind": "status-update",
      "update-data-kind": "none",
      finished: false,
      message: "Working",
      "percent-done": "a quarter",
      time: 1234,
      data: null,
    })
    const { events } = decodeAll(`${drifted}\n`)
    expect(events.map((event) => event.kind)).toEqual(["schema-mismatch"])
    expect(onlyFailure(events).outputKind).toBe("status-update")
  })

  test("a line whose output-kind the contract does not know says so", function () {
    const { events } = decodeAll(`${JSON.stringify({ "output-kind": "future-kind" })}\n`)
    const failure = onlyFailure(events)
    expect(failure.outputKind).toBe("future-kind")
    expect(failure.issueSummary).toContain("unrecognized output-kind")
  })

  test("a rejected line with a non-string output-kind reports no kind", function () {
    const { events } = decodeAll(`${JSON.stringify({ "output-kind": { nested: TOKEN } })}\n`)
    const failure = onlyFailure(events)
    expect(failure.outputKind).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain(TOKEN)
  })

  test("decoding is unaffected by how the stream is chunked", function () {
    const stream = `${outputDataLine}\n${notificationLine}\n${statusUpdateLine}\n`
    const wholeStream = decodeAll(stream)
    const bytewise = decodeAll(...Array.from(stream))
    expect(bytewise.events).toEqual(wholeStream.events)
    expect(bytewise.carry).toBe(wholeStream.carry)
  })

  test("a decoded status update keeps the payload the caller needs", function () {
    const { events } = decodeAll(`${statusUpdateLine}\n`)
    const update = events[0]
    expect(update?.kind).toBe("status-update")
    if (update?.kind === "status-update") {
      expect(update.update["percent-done"]).toBe(0.25)
      expect(update.update.message).toBe("Working")
    }
  })
})
