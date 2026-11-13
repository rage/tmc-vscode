import {
  DeadlinePassedError,
  InsufficientScopeError,
  NotEnrolledError,
  RuntimeError,
} from "../../errors"
import { toWebviewError } from "../../panels/webviewError"

suite("toWebviewError", () => {
  test("carries the sentence and remedies a notification of the error would show", () => {
    expect(toWebviewError(new InsufficientScopeError("403 forbidden"))).toEqual({
      message: expect.stringContaining("Log in again to continue."),
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    })
  })

  test("keeps a CLI failure's details for the panel's disclosure", () => {
    expect(toWebviewError(new RuntimeError("the CLI exited with 1", "stderr tail"))).toEqual({
      message: "The CLI exited with 1.",
      details: "stderr tail",
    })
  })

  test("leaves the HTTP exchange of a backend refusal out, its sentence says it all", () => {
    const debugLines = "Caused by: 422 from http://x/submit\n[DEBUG tmc_langs] compressing /tmp/x"
    for (const refusal of [
      new DeadlinePassedError("The deadline of x has passed.", debugLines),
      new NotEnrolledError("You're no longer enrolled.", debugLines),
    ]) {
      expect(toWebviewError(refusal).details).toBeUndefined()
    }
  })

  test("turns anything else thrown into a sentence", () => {
    expect(toWebviewError("boom")).toEqual({ message: "Boom." })
  })
})
