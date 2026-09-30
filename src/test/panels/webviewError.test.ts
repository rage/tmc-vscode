import { InsufficientScopeError, RuntimeError } from "../../errors"
import { toWebviewError } from "../../panels/webviewError"

suite("toWebviewError", () => {
  test("carries the sentence and remedies a notification of the error would show", () => {
    expect(toWebviewError(new InsufficientScopeError("403 forbidden"), "mooc")).toEqual({
      message: expect.stringContaining("Log in again to continue."),
      actions: [{ label: "Log in", command: "tmc.showMoocLogin" }],
    })
  })

  test("keeps a CLI failure's details for the panel's disclosure", () => {
    expect(toWebviewError(new RuntimeError("the CLI exited with 1", "stderr tail"))).toEqual({
      message: "The CLI exited with 1.",
      details: "stderr tail",
    })
  })

  test("turns anything else thrown into a sentence", () => {
    expect(toWebviewError("boom")).toEqual({ message: "Boom." })
  })
})
