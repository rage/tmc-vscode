import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type Dialog from "../../api/dialog"
import { failure, shownInPanel, withOperation } from "../../api/withOperation"
import { BottleneckError, ConnectionError, InsufficientScopeError } from "../../errors"
import { Logger } from "../../utilities"
import { createMockActionContext } from "../mocks/actionContext"

suite("withOperation", function () {
  let dialog: Dialog

  beforeEach(function () {
    dialog = createMockActionContext().dialog
  })

  function notificationCount(): number {
    return (
      vi.mocked(dialog.reportError).mock.calls.length +
      vi.mocked(dialog.errorNotification).mock.calls.length +
      vi.mocked(dialog.notification).mock.calls.length +
      vi.mocked(dialog.warningNotification).mock.calls.length
    )
  }

  test("resolves to the body's value and shows nothing on success", async function () {
    const result = await withOperation(dialog, { failure: "Failed." }, async () => Ok(42))

    expect(result.val).toBe(42)
    expect(notificationCount()).toBe(0)
  })

  test("reports a plain Err under the options' headline and backend", async function () {
    const error = new Error("langs exited with 1")

    const result = await withOperation(
      dialog,
      { failure: "Failed to add the course.", backend: "tmc" },
      async () => Err(error),
    )

    expect(result.val).toBe(error)
    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to add the course.",
      error,
      "tmc",
    )
    expect(notificationCount()).toBe(1)
  })

  test("leads with a failure's own headline, reporting its cause as the detail", async function () {
    const cause = new Error("langs exited with 1")

    await withOperation(dialog, { failure: "Failed.", backend: "tmc" }, async () =>
      failure("Failed to log out of courses.mooc.fi.", cause, "mooc"),
    )

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to log out of courses.mooc.fi.",
      cause,
      "mooc",
    )
    expect(notificationCount()).toBe(1)
  })

  test("falls back to the options' backend when a failure names none", async function () {
    const cause = new Error("boom")

    await withOperation(dialog, { failure: "Failed.", backend: "tmc" }, async () =>
      failure("Failed to reset exercise.", cause),
    )

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to reset exercise.",
      cause,
      "tmc",
    )
  })

  test("shows a failure without a cause as its headline alone", async function () {
    const result = await withOperation(dialog, { failure: "Failed." }, async () =>
      failure("Missing exercise data for ex-1."),
    )

    expect(dialog.errorNotification).toHaveBeenCalledExactlyOnceWith(
      "Missing exercise data for ex-1.",
      result.val,
    )
    expect(notificationCount()).toBe(1)
  })

  test("turns a throw into an Err reported under the options' headline", async function () {
    const thrown = new Error("unexpected")

    const result = await withOperation(dialog, { failure: "Failed to wipe." }, async () => {
      throw thrown
    })

    expect(result.err).toBe(true)
    expect(result.val).toBe(thrown)
    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith("Failed to wipe.", thrown, undefined)
  })

  test("turns a thrown non-Error into an Error", async function () {
    const result = await withOperation(dialog, { failure: "Failed." }, () =>
      Promise.reject("just a string"),
    )

    expect(result.val).toBeInstanceOf(Error)
    expect((result.val as Error).message).toBe("just a string")
  })

  test("shows a busy rejection once, as information", async function () {
    await withOperation(dialog, { failure: "Failed." }, async () =>
      Err(new BottleneckError("Already submitting.")),
    )

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith("Already submitting.")
    expect(notificationCount()).toBe(1)
  })

  test("recognises a busy rejection a failure wraps", async function () {
    await withOperation(dialog, { failure: "Failed." }, async () =>
      failure("Exercise submission failed.", new BottleneckError("Already submitting.")),
    )

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith("Already submitting.")
    expect(notificationCount()).toBe(1)
  })

  test("logs rather than shows a failure or a busy rejection when silent", async function () {
    const warn = vi.spyOn(Logger, "warn")

    await withOperation(dialog, { failure: "Failed.", silent: true }, async () =>
      Err(new Error("offline")),
    )
    await withOperation(dialog, { failure: "Failed.", silent: true }, async () =>
      Err(new BottleneckError("busy")),
    )

    expect(notificationCount()).toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  test("leaves the operation's own warnings visible when silent", async function () {
    await withOperation(dialog, { failure: "Failed.", silent: true }, async () => {
      void dialog.reportError("Log in again.", new InsufficientScopeError("scope"), "mooc")
      return Err(new Error("offline"))
    })

    expect(dialog.reportError).toHaveBeenCalledOnce()
  })

  test("only logs a failure a panel shows", async function () {
    await withOperation(dialog, { failure: "Submission failed." }, async () =>
      shownInPanel(new ConnectionError("offline")),
    )

    expect(notificationCount()).toBe(0)
  })

  test("still notifies a failure a panel shows when it offers a remedy", async function () {
    const error = new InsufficientScopeError("scope")

    await withOperation(dialog, { failure: "Submission failed.", backend: "mooc" }, async () =>
      shownInPanel(error),
    )

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith("Submission failed.", error, "mooc")
    expect(notificationCount()).toBe(1)
  })

  test("recognises a panel-shown failure a failure wraps", async function () {
    const shown = shownInPanel(new ConnectionError("offline")).val

    await withOperation(dialog, { failure: "Failed." }, async () =>
      failure("Exercise submission failed.", shown),
    )

    expect(notificationCount()).toBe(0)
  })

  test("resolves without waiting for the notification to be dismissed", async function () {
    const never = new Promise<void>(() => {})
    vi.mocked(dialog.reportError).mockReturnValue(never)
    vi.mocked(dialog.errorNotification).mockReturnValue(never)
    vi.mocked(dialog.notification).mockReturnValue(never)
    const hung = Symbol("hung")
    const timeout = (): Promise<typeof hung> =>
      new Promise((resolve) => {
        setTimeout(() => resolve(hung), 50)
      })

    for (const outcome of [
      Err(new Error("boom")),
      failure("Headline only."),
      Err(new BottleneckError("busy")),
    ]) {
      const settled = await Promise.race([
        withOperation(dialog, { failure: "Failed." }, async () => outcome),
        timeout(),
      ])
      expect(settled).not.toBe(hung)
    }
  })

  test("runs the body under a progress notification", async function () {
    const body = vi.fn(async (report: (progress: { fraction: number }) => void) => {
      report({ fraction: 0.5 })
      return Ok("done")
    })

    const result = await withOperation(
      dialog,
      { failure: "Failed.", progress: "Moving data..." },
      body,
    )

    expect(result.val).toBe("done")
    expect(body).toHaveBeenCalledOnce()
    expect(dialog.progressNotification).toHaveBeenCalledWith("Moving data...", expect.any(Function))
  })

  test("forwards the body's reports to the progress bar", async function () {
    const report = vi.fn()
    vi.mocked(dialog.progressNotification).mockImplementation(async (_message, task) =>
      task({ report }, {} as never),
    )

    await withOperation(dialog, { failure: "Failed.", progress: "Moving data..." }, async (r) => {
      r({ fraction: 0.5 })
      return Ok.EMPTY
    })

    expect(report).toHaveBeenCalledExactlyOnceWith({ fraction: 0.5 })
  })

  test("reports a throw from inside the progress notification", async function () {
    const thrown = new Error("unexpected")

    const result = await withOperation(dialog, { failure: "Failed.", progress: "Wiping..." }, () =>
      Promise.reject(thrown),
    )

    expect(result.val).toBe(thrown)
    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith("Failed.", thrown, undefined)
  })

  test("shows no progress notification unless asked", async function () {
    await withOperation(dialog, { failure: "Failed." }, async (report) => {
      report({ fraction: 1 })
      return Ok.EMPTY
    })

    expect(dialog.progressNotification).not.toHaveBeenCalled()
  })
})
