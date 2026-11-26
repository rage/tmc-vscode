import { langsError } from "../api/langsErrors"
import {
  CertificateError,
  FileAccessError,
  ForbiddenError,
  isSessionLost,
  LoginClientRejectedError,
  ProjectsDirUnreachableError,
  ToolchainMissingError,
  AuthorizationError,
  ChapterLockedError,
  ChapterNotOpenError,
  LegacyTmcLoginEndedError,
  CliCrashedError,
  ConnectionError,
  DeadlinePassedError,
  EmptyLangsResponseError,
  ExerciseNotFoundError,
  InitializationError,
  InsufficientScopeError,
  InvalidTokenError,
  isSubmitRefusal,
  NotEnrolledError,
  NotFoundError,
  OutOfTriesError,
  ObsoleteClientError,
  presentationFor,
  ProjectsDirMoveError,
  ProjectsSplitError,
  RateLimitedError,
  RuntimeError,
  ServerError,
  SpawnError,
  TmcLoginNotAcceptedError,
  UploadExpiredError,
  WorkspaceUntrustedError,
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

  test("a server error status reads as the server failing, without host or code", function () {
    const raw = "HTTP error 503 Service Unavailable for https://courses.mooc.fi/x: <html>…</html>"
    const unavailable = Object.assign(new ServerError(raw), { httpStatus: 503 })
    const notFound = Object.assign(new NotFoundError(raw), { httpStatus: 404 })

    expect(presentationFor(Object.assign(unavailable, { backend: "mooc" })).message).toBe(
      "The server ran into a problem. Try again later.",
    )
    expect(presentationFor(Object.assign(new ServerError(raw), { httpStatus: 503 })).message).toBe(
      "The server ran into a problem. Try again later.",
    )
    expect(presentationFor(Object.assign(notFound, { backend: "mooc" })).message).toBe(
      "The server refused the request. Try again later.",
    )
  })

  test("an exercise gone from the server offers to refresh the courses", function () {
    const presentation = presentationFor(new ExerciseNotFoundError("This exercise is gone."))

    expect(presentation.message).toBe(
      "This exercise is no longer in the course. Refresh the courses to see its exercises.",
    )
    expect(presentation.actions).toEqual([
      { label: "Refresh Courses", command: "tmcTreeView.refreshCourses" },
    ])
  })

  // The CLI's message quotes the request URL, which belongs in the logs.
  test("an unreachable backend names neither its host nor its request URL", function () {
    const presentation = presentationFor(
      Object.assign(
        new ConnectionError(
          "Connection error trying to GET http://project-331.local/api/v0/exercise-services/client/courses",
        ),
        { backend: "mooc" },
      ),
    )

    expect(presentation.message).toBe("Could not reach the server. Check your network connection.")
  })

  test("an unreachable server no backend raised keeps its own message", function () {
    expect(presentationFor(new ConnectionError("dns error")).message).toBe("Dns error.")
  })

  test("a lost courses.mooc.fi scope offers the login command", function () {
    const presentation = presentationFor(new InsufficientScopeError("403 forbidden"))

    expect(presentation.message).toBe("You were logged out. Log in again.")
    expect(presentation.actions).toEqual([{ label: "Log In", command: "tmc.showMoocLogin" }])
  })

  test.each([
    ["a rejected token", new InvalidTokenError("Invalid token. Deleted credentials file.")],
    [
      "a lost courses.mooc.fi login",
      Object.assign(new AuthorizationError("Authentication required"), { backend: "mooc" }),
    ],
  ])("%s says the student was logged out and offers the login command", function (_, error) {
    const presentation = presentationFor(error)

    expect(presentation.message).toBe("You were logged out. Log in again.")
    expect(presentation.actions).toEqual([{ label: "Log In", command: "tmc.showMoocLogin" }])
  })

  test("a courses.mooc.fi 403 is lost access to the course, not a logout", function () {
    const error = Object.assign(new ForbiddenError("no_access"), { backend: "mooc" as const })

    expect(presentationFor(error).message).toContain("You do not have access")
    expect(isSessionLost(error)).toBe(false)
  })

  test.each([
    [new CertificateError("tls"), "tmc.openTroubleshooting"],
    [new ToolchainMissingError("python not found"), "tmc.openTroubleshooting"],
    [new FileAccessError("held"), "tmc.openTroubleshooting"],
    [new ProjectsDirUnreachableError("gone"), "tmc.changeTmcDataPath"],
    [new LoginClientRejectedError("client"), "workbench.extensions.action.checkForUpdates"],
  ])("%s offers its remedy", (error, command) => {
    expect(presentationFor(error).actions.map((action) => action.command)).toEqual([command])
  })

  // Logging in again cannot make tmc.mooc.fi accept the login.
  test("a login tmc.mooc.fi does not accept offers no login", function () {
    const presentation = presentationFor(new TmcLoginNotAcceptedError("Ask the course staff."))

    expect(presentation.message).toBe("Ask the course staff.")
    expect(presentation.actions).toEqual([])
  })

  test("Restricted Mode offers to trust the course workspace", function () {
    const presentation = presentationFor(new WorkspaceUntrustedError("restricted"))

    expect(presentation.actions).toEqual([
      { label: "Trust Course Workspace", command: "tmc.trustCourseWorkspace" },
    ])
  })

  test("a failed initialization offers the help panel", function () {
    const presentation = presentationFor(new InitializationError("langs is missing"))

    expect(presentation.message).toBe("TestMyCode could not start. Show Help says how to fix this.")
    expect(presentation.actions).toEqual([
      { label: "Show Help", command: "tmc.viewInitializationErrorHelp" },
    ])
  })

  test("a dropped enrollment offers to enroll again", function () {
    const presentation = presentationFor(new NotEnrolledError("422 from https://…"))
    expect(presentation.message).toBe(
      "You are no longer enrolled on this course. Enroll again, then refresh the course.",
    )
    expect(presentation.actions).toEqual([{ label: "Enroll Again", command: "tmc.enrollOnCourse" }])
  })

  test.each([
    new OutOfTriesError("You have no tries left on loops."),
    new DeadlinePassedError("The deadline of loops has passed."),
    new ChapterNotOpenError("Its chapter has not opened yet."),
    new ChapterLockedError("Its chapter is locked."),
  ])("a refusal by the course's rules stands alone: %s", function (error) {
    expect(presentationFor(error)).toEqual({
      message: error.message,
      actions: [],
      isHeldBack: true,
    })
    expect(isSubmitRefusal(error)).toBe(true)
  })

  test("a dropped enrollment does not name the backend", function () {
    const withBackend = presentationFor(
      Object.assign(new NotEnrolledError("not enrolled"), { backend: "tmc" as const }),
    )

    expect(withBackend.message).not.toContain("tmc.mooc.fi")
  })

  test("a CLI that is gone offers to download it again", function () {
    const presentation = presentationFor(
      Object.assign(new SpawnError("spawn ENOENT"), { code: "ENOENT" }),
    )

    expect(presentation.message).toContain("download them again")
    expect(presentation.actions.map((action) => action.command)).toContain(
      "workbench.action.restartExtensionHost",
    )
  })

  test.each(["EACCES", "EPERM", "UNKNOWN"])(
    "a CLI that %s on spawn names the security policy and IT support",
    function (code) {
      const presentation = presentationFor(Object.assign(new SpawnError(`spawn ${code}`), { code }))

      expect(presentation.message).toContain("security policy")
      expect(presentation.message).toContain("IT support")
      expect(presentation.message).not.toContain("antivirus program may")
    },
  )

  test("a busy CLI asks for a moment, not for a reinstall", function () {
    const presentation = presentationFor(
      Object.assign(new SpawnError("spawn EBUSY"), { code: "EBUSY" }),
    )

    expect(presentation.message).toContain("Try again in a moment")
    expect(presentation.actions).toEqual([])
  })

  test("a CLI that exits without a result reports the exit code and offers a bug report", function () {
    const presentation = presentationFor(
      Object.assign(new EmptyLangsResponseError("no result"), { exitCode: 3 }),
    )

    expect(presentation.message).toContain("exited with code 3")
    expect(presentation.actions.map((action) => action.label)).toEqual(["Report an Issue"])
  })

  test("a CLI killed by a signal says which", function () {
    const presentation = presentationFor(
      Object.assign(new EmptyLangsResponseError("no result"), { signal: "SIGKILL" }),
    )

    expect(presentation.message).toContain("killed by SIGKILL")
  })

  test("a CLI panic offers a bug report instead of the raw panic text", function () {
    const presentation = presentationFor(
      new CliCrashedError("Process panicked unexpectedly with message: index out of bounds"),
    )

    expect(presentation.message).toContain("stopped unexpectedly")
    expect(presentation.message).not.toContain("index out of bounds")
    expect(presentation.actions).toEqual([
      { label: "Report an Issue", command: "workbench.action.openIssueReporter" },
    ])
  })

  test("an expired upload and an obsolete client each state their own remedy", function () {
    expect(presentationFor(new UploadExpiredError("410 gone")).message).toContain("Submit again")
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

  test("a CLI error is worded by its kind, not by the CLI's message", function () {
    const locked = langsError({ kind: "chapter-completed-and-locked" }, "403 from …", "", "mooc")
    const unlocked = langsError({ kind: "chapter-not-unlocked-yet" }, "403 from …", "", "mooc")

    expect(locked).toBeInstanceOf(ChapterLockedError)
    expect(locked.message).toBe("403 from …")
    expect(presentationFor(locked).message).toContain("chapter is locked")
    expect(presentationFor(unlocked).message).toContain("Complete the chapters before")
  })

  test("a file a CLI error is about is named in its sentence", function () {
    const error = langsError({ kind: "disk-full", path: "/home/x" }, "os error 28", "", undefined)

    expect(error).toBeInstanceOf(FileAccessError)
    expect(presentationFor(error).message).toBe(
      "The disk or your home folder quota is full (/home/x). Free some space and try again.",
    )
  })

  test("a missing toolchain keeps the CLI's naming of the program", function () {
    const error = langsError({ kind: "toolchain-missing" }, "python was not found", "", undefined)

    expect(presentationFor(error).message).toMatch(/^Python was not found\. If you installed/)
  })

  test("a rate limit says how long to wait, and blames Get Help only for pastes", function () {
    const limited = langsError({ kind: "rate-limited", retryAfterSeconds: 300 }, "429", "", "mooc")

    expect(presentationFor(limited).message).toContain("from your network. Try again in 5 minutes")
    Object.assign(limited, { isPasteLimit: true })
    expect(limited).toBeInstanceOf(RateLimitedError)
    expect(presentationFor(limited).message).toContain("used Get Help on this exercise too often")
  })

  test("a refused tmc.mooc.fi token ends only the old tmc.mooc.fi login", function () {
    const error = langsError({ kind: "invalid-token" }, "401", "", "tmc")

    expect(error).toBeInstanceOf(LegacyTmcLoginEndedError)
    expect(isSessionLost(error)).toBe(false)
    expect(presentationFor(error).message).toContain("old tmc.mooc.fi login has ended")
  })

  test("a failed folder move gives the cause's sentence and remedy, then where the exercises are", function () {
    const cause = langsError(
      { kind: "projects-dir-unreachable", path: "/mnt" },
      "gone",
      "",
      undefined,
    )

    const { message, actions } = presentationFor(
      new ProjectsDirMoveError(cause, "Your exercises are now in /old."),
    )

    expect(message).toMatch(/^The exercises folder \(\/mnt\) cannot be reached\./)
    expect(message).toContain("then try again. Your exercises are now in /old.")
    expect(actions).toEqual(presentationFor(cause).actions)
  })

  test("an interrupted set-aside names the folder the other half of the exercises is in", function () {
    const error = langsError({ kind: "projects-split", path: "/aside" }, "split", "", undefined)

    expect(error).toBeInstanceOf(ProjectsSplitError)
    expect(presentationFor(error).message).toContain("exercises folder and /aside.")
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
