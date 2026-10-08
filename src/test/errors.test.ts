import {
  ConnectionError,
  ExerciseNotFoundError,
  InitializationError,
  InsufficientScopeError,
  NotEnrolledError,
  NotFoundError,
  ObsoleteClientError,
  presentationFor,
  RuntimeError,
  ServerError,
  SpawnError,
  UploadExpiredError,
} from "../errors"
import { Logger, LogLevel } from "../utilities/logger"

suite("presentationFor", function () {
  afterEach(function () {
    Logger.configure(LogLevel.None)
    Logger.output = undefined
  })

  test("an unmapped error is its own message with nothing to press", function () {
    const presentation = presentationFor(new RuntimeError("the CLI exited with 1"))

    expect(presentation.message).toBe("The CLI exited with 1.")
    expect(presentation.actions).toEqual([])
  })

  test("a server error status reads as the server failing, not as the network", function () {
    const raw = "HTTP error 503 Service Unavailable for https://courses.mooc.fi/x: <html>…</html>"
    const unavailable = Object.assign(new ServerError(raw), { httpStatus: 503 })
    const notFound = Object.assign(new NotFoundError(raw), { httpStatus: 404 })

    expect(presentationFor(unavailable, "mooc").message).toBe(
      "courses.mooc.fi returned an error (503). Try again later.",
    )
    expect(presentationFor(unavailable).message).toBe(
      "The server returned an error (503). Try again later.",
    )
    expect(presentationFor(notFound, "mooc").message).toBe(
      "courses.mooc.fi returned an error (404).",
    )
  })

  test("an exercise gone from the server offers to refresh the courses", function () {
    const presentation = presentationFor(new ExerciseNotFoundError("This exercise is gone."))

    expect(presentation.message).toBe(
      "This exercise is gone. Refresh the courses to see the course's current exercises.",
    )
    expect(presentation.actions).toEqual([
      { label: "Refresh Courses", command: "tmcTreeView.refreshCourses" },
    ])
  })

  test("an unreachable server keeps its own message", function () {
    const presentation = presentationFor(new ConnectionError("dns error"), "mooc")

    expect(presentation.message).toBe("Dns error.")
  })

  test("a lost courses.mooc.fi scope offers the login command", function () {
    const presentation = presentationFor(new InsufficientScopeError("403 forbidden"))

    expect(presentation.message).toContain("Log in again to continue")
    expect(presentation.actions).toEqual([{ label: "Log in", command: "tmc.showMoocLogin" }])
  })

  test("a failed initialization offers the help panel", function () {
    const presentation = presentationFor(new InitializationError("langs is missing"))

    expect(presentation.message).toBe(
      "Langs is missing. The help page lists what failed and how to fix it.",
    )
    expect(presentation.actions).toEqual([
      { label: "Show help", command: "tmc.viewInitializationErrorHelp" },
    ])
  })

  test("a dropped enrollment names the backend to re-enroll on when the caller knows it", function () {
    const withBackend = presentationFor(new NotEnrolledError("not enrolled"), "tmc")
    const withoutBackend = presentationFor(new NotEnrolledError("not enrolled"))

    expect(withBackend.message).toContain("Enroll on the course again on TMC Server")
    expect(withoutBackend.message).toContain("Enroll on the course again,")
    expect(withoutBackend.message).not.toContain("TMC Server")
  })

  test("a CLI that cannot run points at the antivirus help", function () {
    const presentation = presentationFor(new SpawnError("spawn EACCES"))

    expect(presentation.message).toContain("antivirus")
    expect(presentation.actions).toEqual([
      { label: "Show help", command: "tmc.viewInitializationErrorHelp" },
    ])
  })

  test("an expired upload and an obsolete client each state their own remedy", function () {
    expect(presentationFor(new UploadExpiredError("410 gone")).message).toContain("try again")
    const obsolete = presentationFor(new ObsoleteClientError("too old"))
    expect(obsolete.message).toContain("out of date")
    expect(obsolete.actions).toEqual([
      { label: "Update Extension", command: "workbench.extensions.action.checkForUpdates" },
    ])
  })

  test("the sentence names no error class and ends in exactly one stop", function () {
    expect(presentationFor(new RuntimeError("The server sent no paste link.")).message).toBe(
      "The server sent no paste link.",
    )
    expect(presentationFor(new Error("Is the CLI installed?")).message).toBe(
      "Is the CLI installed?",
    )
    expect(presentationFor(new RuntimeError("")).message).toBe("Runtime Error.")
    expect(presentationFor(new RuntimeError("tmc-langs-cli exited")).message).toBe(
      "tmc-langs-cli exited.",
    )
  })

  test("the sentence holds none of a CLI failure's diagnostics", function () {
    Logger.configure(LogLevel.Verbose)
    // What a langs failure attaches: the CLI's own backtrace, then the tail of the
    // process's stderr, which a long test run measures in kilobytes.
    const details = ["at tmc_langs::submit", "", "thread 'main' panicked", "note: run with…"].join(
      "\n",
    )
    const error = new RuntimeError(new Error("the CLI exited with 1"), details)
    error.cause = "EPIPE while writing the submission archive"

    const { message } = presentationFor(error)

    expect(error.stack).toBeTruthy()
    expect(message).toBe("The CLI exited with 1.")
    for (const line of details.split("\n").filter(Boolean)) {
      expect(message).not.toContain(line)
    }
    expect(message).not.toContain("EPIPE")
    expect(message).not.toContain("<TRACE>")
  })
})
