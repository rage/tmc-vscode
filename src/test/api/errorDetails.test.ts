import * as os from "os"
import * as path from "path"

import { BaseError } from "../../../shared/lib"
import { errorDetails } from "../../api/errorDetails"
import { InsufficientScopeError } from "../../errors"

suite("errorDetails", function () {
  test("keeps a failure's summary, remedies and cause chain under the id it returns", function () {
    const cause = new BaseError("connection reset", "GET https://tmc.mooc.fi/api/v8/x")
    const id = errorDetails.record(
      "Failed to download the exercise.",
      Object.assign(new InsufficientScopeError("403 forbidden"), { cause }),
    )

    expect(errorDetails.get(id)).toEqual({
      summary: "Failed to download the exercise.",
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
      causeChain:
        "Insufficient Scope Error: 403 forbidden\n\n" +
        "Caused by: Base Error: connection reset\nGET https://tmc.mooc.fi/api/v8/x",
      occurredAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    })
  })

  test("leaves credentials out of the cause chain", function () {
    const id = errorDetails.record(
      "Failed.",
      new BaseError("refused", "Authorization: Bearer abcdefghijklmnopqrstuvwxyzABCDEF0123456789"),
    )

    expect(errorDetails.get(id)?.causeChain).not.toContain("abcdefghij")
  })

  test("leaves the home directory out of what it shows", function () {
    const home = os.homedir()
    const id = errorDetails.record(
      `Failed to open ${path.join(home, "a")}.`,
      new BaseError(`EACCES ${path.join(home, "tmc", "cli")}`),
    )

    const details = errorDetails.get(id)
    expect(details?.summary).not.toContain(home)
    expect(details?.causeChain).not.toContain(home)
  })

  test("forgets all but the latest twenty, the oldest first", function () {
    const ids = Array.from({ length: 21 }, (_, n) => errorDetails.record(`${n}`, new Error("x")))

    expect(errorDetails.get(ids[0]!)).toBeUndefined()
    expect(errorDetails.get(ids[1]!)?.summary).toBe("1")
    expect(errorDetails.get(ids[20]!)?.summary).toBe("20")
  })

  test("knows nothing of an id from before a reload", function () {
    expect(errorDetails.get("from-another-extension-host")).toBeUndefined()
  })
})
