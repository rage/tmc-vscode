import { errorDetails } from "../../api/errorDetails"
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
      message: expect.stringContaining("Log in again."),
      detailsId: expect.any(String),
      actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
    })
  })

  test("keeps a CLI failure's details for its Show Details screen", () => {
    const shown = toWebviewError(new RuntimeError("the CLI exited with 1", "stderr tail"))

    expect(shown).toEqual({ message: "The CLI exited with 1.", detailsId: expect.any(String) })
    expect(errorDetails.get(shown.detailsId!)).toMatchObject({
      summary: "The CLI exited with 1.",
      causeChain: "Runtime Error: the CLI exited with 1\nstderr tail",
    })
  })

  test("leaves the HTTP exchange of a backend refusal out, its sentence says it all", () => {
    const debugLines = "Caused by: 422 from http://x/submit\n[DEBUG tmc_langs] compressing /tmp/x"
    for (const refusal of [
      new DeadlinePassedError("The deadline of x has passed.", debugLines),
      new NotEnrolledError("You're no longer enrolled.", debugLines),
    ]) {
      expect(toWebviewError(refusal).detailsId).toBeUndefined()
    }
  })

  test("turns anything else thrown into a sentence", () => {
    expect(toWebviewError("boom")).toEqual({ message: "Boom.", detailsId: expect.any(String) })
  })
})
