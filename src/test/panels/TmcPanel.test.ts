import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { ConnectionError, ForbiddenError, InitializationError, presentationFor } from "../../errors"
import { postUpdateables } from "../../panels/exerciseLists"
import { moocLoginRegistry } from "../../panels/moocLoginRegistry"
import type { WebviewHandlers } from "../../panels/TmcPanel"
import { nextPanelId, registerWebviewHandlers, TmcPanel } from "../../panels/TmcPanel"
import { updateablesRegistry } from "../../panels/updateablesRegistry"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSchema,
  makeMoocKind,
  makeTmcKind,
} from "../../shared/shared"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"
import { createMockContext } from "../mocks/vscode"

// Fabricates a minimal `WebviewPanel`/`Webview` pair, standing in for the
// real VS Code webview host: just enough for `TmcPanel`'s constructor
// (`_getWebviewContent`, `_setWebviewMessageListener`) and `dispose()` to run,
// while capturing the registered message listener so a test can drive it
// directly, and the `dispose` spy so the "close on standalone login success"
// behavior is observable.
function createFakeWebviewPanel(): {
  panel: vscode.WebviewPanel
  dispose: ReturnType<typeof vi.fn>
  getMessageListener: () => (message: unknown) => Promise<void>
} {
  let listener: ((message: unknown) => Promise<void>) | undefined
  let disposeListener: (() => void) | undefined
  let panelDisposed = false
  // the real host calls back into `TmcPanel.dispose()` from here, once
  const dispose = vi.fn(() => {
    if (panelDisposed) {
      return
    }
    panelDisposed = true
    disposeListener?.()
  })
  const webview = {
    html: "",
    cspSource: "self",
    // the real API resolves to whether the webview received it; `postMessageToWebview`
    // reads that to warn about undelivered messages
    postMessage: vi.fn(() => Promise.resolve(true)),
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: vi.fn((callback: (message: unknown) => Promise<void>) => {
      listener = callback
      return { dispose: vi.fn() }
    }),
  }
  const panel = {
    webview,
    onDidDispose: vi.fn((callback: () => void) => {
      disposeListener = callback
      return { dispose: vi.fn() }
    }),
    reveal: vi.fn(),
    dispose,
  }
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    dispose,
    getMessageListener: () => {
      if (!listener) {
        throw new Error("webview message listener was never registered")
      }
      return listener
    },
  }
}

suite("TmcPanel moocLogin handling", () => {
  test("a successful login closes the side panel and offers add-new-course", async () => {
    // Isolate from any panel state a previous test in this file may have left behind.
    TmcPanel.sidePanel?.dispose()
    TmcPanel.sidePanel = undefined

    const { panel, dispose, getMessageListener } = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockReturnValue(panel)

    const extensionContext = createMockContext()
    const extensionUri = vscode.Uri.file("/ext")
    const actionContext = createMockActionContext()
    const authenticateMooc = vi.fn().mockReturnValue({
      result: Promise.resolve(Ok(undefined)),
      interrupt: vi.fn(),
    })
    actionContext.startup.langs = { authenticateMooc } as unknown as Langs

    // Render the MoocLogin panel standalone, the way `tmc.showMoocLogin` does.
    const loginPanelId = nextPanelId()
    TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
      id: loginPanelId,
      type: "MoocLogin",
    })
    expect(createWebviewPanel).toHaveBeenCalledTimes(1)

    // Simulate the webview posting `moocLogin` on mount.
    const listener = getMessageListener()
    await listener({
      type: "moocLogin",
      sourcePanel: { id: loginPanelId, type: "MoocLogin" },
    })

    expect(authenticateMooc).toHaveBeenCalledTimes(1)
    // The side panel is closed...
    expect(dispose).toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeUndefined()
    // ...and a confirmation toast is shown, offering the step the user most
    // likely came for without forcing it on a session-renewal login.
    expect(actionContext.dialog.notification).toHaveBeenCalledWith(
      "Logged in to courses.mooc.fi.",
      ["Add new course", expect.any(Function)],
    )
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const [, button] = vi.mocked(actionContext.dialog.notification).mock.calls[0] as [
      string,
      [string, () => void],
    ]
    button[1]()
    expect(executeCommand).toHaveBeenCalledWith("tmc.addNewCourse")
    executeCommand.mockRestore()
  })

  const loginPanel = { id: 9, type: "MoocLogin" }

  test("answers the waiting panel when the extension is not initialized", async () => {
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "moocLogin", sourcePanel: loginPanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "moocLoginError", target: loginPanel }),
    )
  })

  test("answers the waiting panel when the login rejects", async () => {
    const actionContext = createMockActionContext()
    actionContext.startup.langs = {
      authenticateMooc: () => ({
        result: Promise.reject(new Error("the CLI crashed")),
        interrupt: vi.fn(),
      }),
    } as unknown as Langs
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "moocLogin", sourcePanel: loginPanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "moocLoginError",
        target: loginPanel,
        error: "the CLI crashed",
      }),
    )
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
  })
})

// Mounts a fresh side panel (resetting any panel state a previous test left
// behind) and returns the fake webview panel + its captured message listener,
// so a test can post a message directly and inspect what got posted back.
async function mountSidePanel(
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext = createMockContext(),
): Promise<{
  panel: ReturnType<typeof createFakeWebviewPanel>["panel"]
  listener: (message: unknown) => Promise<void>
}> {
  TmcPanel.sidePanel?.dispose()
  TmcPanel.sidePanel = undefined

  const { panel, getMessageListener } = createFakeWebviewPanel()
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

  const extensionUri = vscode.Uri.file("/ext")

  TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
    id: nextPanelId(),
    type: "MyCourses",
    courseDeadlines: {},
  })
  const listener = getMessageListener()
  // Clear the initial mount's `setPanel` post so assertions below only see
  // what the handler under test itself posts.
  vi.mocked(panel.webview.postMessage).mockClear()

  return { panel, listener }
}

suite("TmcPanel initialization guards", () => {
  test("a panel waiting on data is told it is not coming", async () => {
    // Nothing else ever answers `requestMyCoursesData`, so returning silently here
    // leaves the panel on its spinner for the rest of the session.
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const, courseDeadlines: {} }

    await listener({ type: "requestMyCoursesData", requestId: 1, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelDataResult",
        target: { id: sourcePanel.id, type: sourcePanel.type },
        requestId: 1,
        error: { message: expect.stringContaining("did not initialize properly") },
      }),
    )
  })

  test("a course that cannot be read is reported to the panel showing it", async () => {
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Err(new Error("no such course")) } as never },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
      exerciseStatuses: { tmc: {}, mooc: {} },
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelDataResult",
        requestId: 1,
        error: { message: "no such course" },
      }),
    )
  })

  test("the welcome panel is told when its data is not coming", async () => {
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 9, type: "Welcome" as const }

    await listener({ type: "requestWelcomeData", requestId: 4, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelDataResult",
        target: { id: sourcePanel.id, type: sourcePanel.type },
        requestId: 4,
        error: { message: expect.stringContaining("did not initialize properly") },
      }),
    )
  })

  test("a courses request without an exercise directory says why, in the panel and a toast", async () => {
    const actionContext = createMockActionContext({
      startup: {
        userData: { getCourses: () => [] } as never,
        resources: { projectsDirectory: undefined } as never,
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const, courseDeadlines: {} }

    await listener({ type: "requestMyCoursesData", requestId: 3, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelDataResult",
        requestId: 3,
        error: { message: "tmc-langs did not report an exercise directory" },
      }),
    )
    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      "Showing your courses is unavailable: tmc-langs did not report an exercise directory.",
      expect.any(Error),
    )
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
  })

  test("a request served from stored data is answered without an error", async () => {
    const actionContext = createMockActionContext({
      startup: {
        userData: { getCourses: () => [] } as never,
        resources: { projectsDirectory: "/tmc" } as never,
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const, courseDeadlines: {} }

    await listener({ type: "requestMyCoursesData", requestId: 7, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "panelDataResult",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      requestId: 7,
    })
  })

  test("a click that cannot be served is reported, with a route to the help panel", async () => {
    const actionContext = createDegradedContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({ type: "removeCourse", id: CourseIdentifier.from(1) })

    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      "This action is unavailable.",
      expect.any(InitializationError),
    )
    const [, error] = vi.mocked(actionContext.dialog.reportError).mock.calls[0] as [string, Error]
    expect(presentationFor(error).actions).toEqual([
      { label: "Show help", command: "tmc.viewInitializationErrorHelp" },
    ])
  })
})

// `cliFolder` reads `extensionContext.globalStorageUri`, which the shared
// `createMockContext()` leaves as an auto-mocked function rather than a `Uri`; give it
// a real one so this handler's other side effect doesn't crash before posting anything.
function contextWithGlobalStorage(): vscode.ExtensionContext {
  const base = createMockContext()
  return new Proxy(base, {
    get: (target, prop) =>
      prop === "globalStorageUri"
        ? vscode.Uri.file("/mock-global-storage")
        : Reflect.get(target, prop),
  }) as vscode.ExtensionContext
}

suite("TmcPanel requestInitializationErrors", () => {
  const sourcePanel = { id: 7, type: "InitializationErrorHelp" as const }

  test("a degraded startup renders each failed service's message, keyed by the service", async () => {
    const actionContext = createDegradedContext({
      failures: {
        langs: new Error("langs offline"),
        userData: new Error("corrupt user data"),
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "initializationErrors",
        initializationErrors: expect.objectContaining({
          tmc: expect.objectContaining({ error: "langs offline" }),
          userData: expect.objectContaining({ error: "corrupt user data" }),
        }),
      }),
    )
  })

  test("a ready startup reports no initialization failures", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "initializationErrors",
        initializationErrors: {
          tmc: null,
          userData: null,
          workspaceManager: null,
          resources: null,
          exerciseDecorationProvider: null,
        },
      }),
    )
  })

  test("a service absent from the failures map is reported as null, not empty or crashing", async () => {
    // Only `langs` failed; the root cause never touched the other four, which is
    // distinct from a service that ran and failed itself.
    const actionContext = createDegradedContext({ failures: { langs: new Error("langs offline") } })
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "initializationErrors",
        initializationErrors: expect.objectContaining({
          userData: null,
          workspaceManager: null,
          resources: null,
          exerciseDecorationProvider: null,
        }),
      }),
    )
  })

  test("folds a failure's cause into the reported message", async () => {
    const actionContext = createDegradedContext({
      failures: { langs: new Error("langs offline", { cause: "network unreachable" }) },
    })
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "initializationErrors",
        initializationErrors: expect.objectContaining({
          tmc: expect.objectContaining({ error: "langs offline: network unreachable" }),
        }),
      }),
    )
  })
})

// The panel layer cannot import `src/actions` or `src/commands` without recreating the
// runtime import cycle, so every one of those calls goes through this record instead.
function stubHandlers(): { [K in keyof WebviewHandlers]: ReturnType<typeof vi.fn> } {
  return {
    cancelTests: vi.fn(),
    closeExercises: vi.fn().mockResolvedValue(Err(new Error("could not close"))),
    downloadAndOpenExercises: vi.fn().mockResolvedValue(Ok([])),
    downloadExercisesForUi: vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    pasteExercise: vi.fn().mockResolvedValue(Ok("link")),
    refreshLocalExercises: vi.fn().mockResolvedValue(Ok.EMPTY),
    removeCourse: vi.fn().mockResolvedValue(undefined),
    submitExercise: vi.fn().mockResolvedValue(Ok(undefined)),
    updateCourse: vi.fn().mockResolvedValue(Ok(true)),
  }
}

suite("TmcPanel handler dispatch", () => {
  test("closes exercises through the registered handler and reports its failure", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)
    const courseId = CourseIdentifier.from(42)
    const ids = [ExerciseIdentifier.from(101)]

    await listener({ type: "closeExercises", ids, courseId })

    expect(handlers.closeExercises).toHaveBeenCalledWith(actionContext, ids, courseId)
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      "Failed to close the selected exercises.",
      expect.any(Error),
    )
  })

  test("reports a handler that rejects instead of dropping it", async () => {
    // The webview host discards whatever a listener rejects with, so nothing else
    // would tell the user their click failed.
    const handlers = stubHandlers()
    handlers.closeExercises.mockRejectedValue(new Error("handler exploded"))
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({
      type: "closeExercises",
      ids: [ExerciseIdentifier.from(101)],
      courseId: CourseIdentifier.from(42),
    })

    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      "Something went wrong while handling that action.",
      expect.objectContaining({ message: "handler exploded" }),
    )
  })

  test("cancels a test run through the registered handler", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "cancelTests", testRunId: 7 })

    expect(handlers.cancelTests).toHaveBeenCalledWith(7)
  })

  test("a course refresh rescans the exercises on disk before re-rendering", async () => {
    // `updateCourse` does not rescan, and the CourseDetails panel that renders next
    // reads exercise statuses out of the workspace manager.
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({ type: "refreshCourseDetails", id: CourseIdentifier.from(42), useCache: false })

    expect(handlers.refreshLocalExercises).toHaveBeenCalledWith(actionContext)
  })

  const pasteMessage = {
    type: "pasteExercise",
    course: makeTmcKind({
      id: 42,
      name: "python-course",
      title: "Python Course",
      description: "",
      organization: "mooc",
      exercises: [],
      availablePoints: 0,
      awardedPoints: 0,
      perhapsExamMode: false,
      newExercises: [],
      notifyAfter: 0,
      disabled: false,
      materialUrl: null,
    }),
    exercise: makeTmcKind({
      id: 101,
      name: "loops",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    }),
    requestingPanel: { id: 5, type: "ExerciseTests" },
  }

  test("a paste link goes back to the panel that asked for it", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const { panel, listener } = await mountSidePanel(createMockActionContext())

    await listener(pasteMessage)

    expect(handlers.pasteExercise).toHaveBeenCalledWith(
      expect.anything(),
      "tmc",
      "python-course",
      "loops",
    )
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pasteResult", pasteLink: "link" }),
    )
  })

  test("a mooc course's exercise is pasted through the mooc backend", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({
      ...pasteMessage,
      course: makeMoocKind({ ...pasteMessage.course.data, id: "course-uuid" }),
      exercise: makeMoocKind({ ...pasteMessage.exercise.data, id: "exercise-uuid" }),
    })

    expect(handlers.pasteExercise).toHaveBeenCalledWith(
      expect.anything(),
      "mooc",
      "python-course",
      "loops",
    )
  })

  test("a failed paste is reported in the panel, and not also as a notification", async () => {
    // The panel that asked is on screen and renders the failure itself, so a toast
    // would be the second report of one failure.
    const handlers = stubHandlers()
    handlers.pasteExercise.mockResolvedValue(Err(new Error("paste service is down")))
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener(pasteMessage)

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pasteError", error: "paste service is down" }),
    )
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })
})

// A webview mounted before a failed (or since-degraded) activation can still post any
// of these messages; each must be answered rather than silently dropped.
suite("TmcPanel handler dispatch, degraded startup", () => {
  const UNAVAILABLE_ACTION = "This action is unavailable."

  test("closeExercises reports the failure instead of calling the handler", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({
      type: "closeExercises",
      ids: [ExerciseIdentifier.from(101)],
      courseId: CourseIdentifier.from(42),
    })

    expect(handlers.closeExercises).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
  })

  test("downloadExercises reports the failure instead of calling the handler", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({
      type: "downloadExercises",
      mode: "download",
      courseId: CourseIdentifier.from(42),
      ids: [ExerciseIdentifier.from(101)],
    })

    expect(handlers.downloadExercisesForUi).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
  })

  test("openExercises reports the failure instead of calling the handler", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener({
      type: "openExercises",
      ids: [ExerciseIdentifier.from(101)],
      courseId: CourseIdentifier.from(42),
    })

    expect(handlers.downloadAndOpenExercises).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
  })

  test("refreshCourseDetails reports the failure and re-renders nothing", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "refreshCourseDetails", id: CourseIdentifier.from(42), useCache: false })

    expect(handlers.updateCourse).not.toHaveBeenCalled()
    expect(handlers.refreshLocalExercises).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
    // No re-render either: a CourseDetails panel would just ask for data nothing
    // can serve, the same way the initial request would have failed.
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "setPanel" }),
    )
  })

  // Shared by submitExercise and pasteExercise below: both messages carry the full
  // course/exercise the schema requires, not just an id.
  const fixtureCourse = makeTmcKind({
    id: 42,
    name: "python-course",
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })
  const fixtureExercise = makeTmcKind({
    id: 101,
    name: "loops",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    passed: false,
    softDeadline: null,
  })

  test("submitExercise reports the failure and unsticks the waiting Submit button", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({
      type: "submitExercise",
      course: fixtureCourse,
      exercise: fixtureExercise,
      exerciseUri: vscode.Uri.file("/exercise"),
    })

    expect(handlers.submitExercise).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "submitFailed", target: { type: "ExerciseTests" } }),
    )
  })

  const pasteMessage = {
    type: "pasteExercise",
    course: fixtureCourse,
    exercise: fixtureExercise,
    requestingPanel: { id: 5, type: "ExerciseTests" },
  }

  test("pasteExercise reports the failure and answers the waiting panel", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener(pasteMessage)

    expect(handlers.pasteExercise).not.toHaveBeenCalled()
    expect(actionContext.dialog.reportError).toHaveBeenCalledWith(
      UNAVAILABLE_ACTION,
      expect.any(InitializationError),
    )
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pasteError",
        target: pasteMessage.requestingPanel,
        error: "The extension did not initialize properly",
      }),
    )
  })
})

suite("TmcPanel inbound message guard", () => {
  // The webview is a separate document; its messages are the extension's one untrusted
  // input, and nothing downstream re-checks them.
  async function drive(message: unknown): Promise<{
    handlers: ReturnType<typeof stubHandlers>
    posted: ReturnType<typeof vi.fn>
  }> {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const { panel, listener } = await mountSidePanel(createMockActionContext())
    await listener(message)
    return { handlers, posted: vi.mocked(panel.webview.postMessage) }
  }

  test("ignores a message whose type it does not know", async () => {
    const { handlers, posted } = await drive({ type: "notAKnownMessage", testRunId: 7 })

    expect(handlers.cancelTests).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("ignores a known message that is missing a required field", async () => {
    const { handlers, posted } = await drive({ type: "cancelTests" })

    expect(handlers.cancelTests).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("acts on the same message once it carries the field", async () => {
    const { handlers } = await drive({ type: "cancelTests", testRunId: 7 })

    expect(handlers.cancelTests).toHaveBeenCalledWith(7)
  })
})

suite("TmcPanel webview-supplied paths and links", () => {
  test("resolves the workspace slug from storage rather than from the message", async () => {
    // The slug becomes a `.code-workspace` path the extension writes and opens, so a
    // name the webview chose must never reach it.
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Ok(courseWith(0)) } as never },
    })
    const { listener } = await mountSidePanel(actionContext)

    await listener({ type: "openCourseWorkspace", courseId: CourseIdentifier.from(42) })

    expect(handlers.openWorkspace).toHaveBeenCalledWith(actionContext, "python-course", "tmc")
  })

  test("opens an https link the webview asks for", async () => {
    const openExternal = stubOpenExternal()
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "openLinkInBrowser", url: "https://tmc.mooc.fi/paste/abc" })

    expect(openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "https", authority: "tmc.mooc.fi" }),
    )
  })

  test("refuses a link that is not http or https", async () => {
    // `Uri.parse` in its default mode invents a `file` scheme for anything without one,
    // so an unrestricted link would reach the OS handler as a local path.
    const openExternal = stubOpenExternal()
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "openLinkInBrowser", url: "file:///etc/passwd" })

    expect(openExternal).not.toHaveBeenCalled()
  })
})

suite("TmcPanel addNewCourse handling", () => {
  test("runs the add-course command rather than opening a selection webview", async () => {
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)

    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    try {
      await listener({ type: "addNewCourse" })

      expect(executeCommand).toHaveBeenCalledWith("tmc.addNewCourse")
    } finally {
      executeCommand.mockRestore()
    }
  })
})

suite("TmcPanel cancelMoocLogin handling", () => {
  test("cancels the in-flight login registered under the source panel's id", async () => {
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)

    const cancelSpy = vi.spyOn(moocLoginRegistry, "cancel")
    try {
      const sourcePanel = { id: 13, type: "MoocLogin" as const }
      await listener({ type: "cancelMoocLogin", sourcePanel })

      expect(cancelSpy).toHaveBeenCalledWith(13)
    } finally {
      cancelSpy.mockRestore()
    }
  })
})

suite("TmcPanel ready handshake", () => {
  test("resends the last rendered panel", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "ready" })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "MyCourses" }),
      }),
    )
  })

  test("resends whichever panel was rendered last, not the one mounted with", async () => {
    // A stale _lastPanel is the way this feature makes things worse than the bug it
    // fixes, so every render path has to keep it current.
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "openCourseDetails", courseId: makeTmcKind({ courseId: 1 }) })
    vi.mocked(panel.webview.postMessage).mockClear()
    await listener({ type: "ready" })

    const setPanels = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => message as { type: string; panel?: { type: string } })
      .filter((message) => message.type === "setPanel")
    expect(setPanels).toHaveLength(1)
    expect(setPanels[0]?.panel?.type).toBe("CourseDetails")
  })

  test("replays a buffered message for the current panel, after the panel itself", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    const lastPanel = (TmcPanel.sidePanel as unknown as { _lastPanel: { id: number } })._lastPanel
    TmcPanel.postMessage({
      type: "setTmcDataSize",
      target: { id: lastPanel.id, type: "MyCourses" },
      tmcDataSize: "1.2 MB",
    })
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel", "setTmcDataSize"])
  })

  test("does not replay a message aimed at a panel that is no longer shown", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    // an id that was never rendered here; buffering it would resend it to a panel
    // that cannot interpret it
    TmcPanel.postMessage({
      type: "setTmcDataSize",
      target: { id: 9999, type: "MyCourses" },
      tmcDataSize: "1.2 MB",
    })
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel"])
  })

  test("rendering a new panel drops the previous panel's buffered messages", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    const lastPanel = (TmcPanel.sidePanel as unknown as { _lastPanel: { id: number } })._lastPanel
    TmcPanel.postMessage({
      type: "setTmcDataSize",
      target: { id: lastPanel.id, type: "MyCourses" },
      tmcDataSize: "1.2 MB",
    })
    await listener({ type: "openCourseDetails", courseId: makeTmcKind({ courseId: 1 }) })
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel"])
  })

  test("a webview that has rendered nothing gets nothing resent", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    ;(TmcPanel.sidePanel as unknown as { _lastPanel: undefined })._lastPanel = undefined

    await listener({ type: "ready" })

    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })

  test("keeps hidden webviews alive, so a reveal does not reload them", async () => {
    const actionContext = createMockActionContext()
    await mountSidePanel(actionContext)

    expect(vi.mocked(vscode.window.createWebviewPanel)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ retainContextWhenHidden: true }),
    )
  })
})

suite("TmcPanel requestCourseDetailsData updateables", () => {
  const COURSE_ID = CourseIdentifier.from(42)
  const OTHER_COURSE_ID = CourseIdentifier.from(43)

  const localCourse = makeTmcKind({
    id: 42,
    name: "python-course",
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })

  function contextWithCourse(): ReturnType<typeof createMockActionContext> {
    return createMockActionContext({
      startup: {
        langs: {
          getCourseDetails: vi.fn().mockResolvedValue(Err(new Error("offline"))),
        } as unknown as Langs,
        userData: { getCourse: () => Ok(localCourse) } as never,
        workspaceManager: { getExercises: () => [] } as never,
      },
    })
  }

  afterEach(() => {
    updateablesRegistry.clear()
  })

  test("answers with the course's own updateables, not another course's", async () => {
    // A reloaded CourseDetails panel can only get this from the extension: re-deriving
    // it would mean re-running checkForExerciseUpdates.
    postUpdateables(COURSE_ID, [ExerciseIdentifier.from(101)])
    postUpdateables(OTHER_COURSE_ID, [ExerciseIdentifier.from(202), ExerciseIdentifier.from(203)])

    const actionContext = contextWithCourse()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: COURSE_ID,
      exerciseStatuses: { tmc: {}, mooc: {} },
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "setUpdateables",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      courseId: COURSE_ID,
      exerciseIds: [ExerciseIdentifier.from(101)],
    })
  })

  test("answers with an empty list for a course that has no updates", async () => {
    const actionContext = contextWithCourse()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: COURSE_ID,
      exerciseStatuses: { tmc: {}, mooc: {} },
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "setUpdateables", exerciseIds: [] }),
    )
  })
})

// `jest-mock-vscode` ships no `env` namespace, so the tests that drive link opening
// install one on the mock the `vscode` alias resolves to.
const vscodeMock = vscode as unknown as { env: { openExternal: (uri: vscode.Uri) => void } }

function stubOpenExternal(): ReturnType<typeof vi.fn> {
  const openExternal = vi.fn()
  vscodeMock.env = { openExternal }
  return openExternal
}

// Discards whatever panels a previous test left mounted.
function resetPanels(): void {
  TmcPanel.mainPanel?.dispose()
  TmcPanel.mainPanel = undefined
  TmcPanel.sidePanel?.dispose()
  TmcPanel.sidePanel = undefined
}

suite("TmcPanel main panel lifecycle", () => {
  beforeEach(resetPanels)
  afterEach(resetPanels)

  test("navigating the main panel reuses its webview instead of recreating it", async () => {
    const { panel, dispose } = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(panel)

    const extensionContext = createMockContext()
    const extensionUri = vscode.Uri.file("/ext")
    const actionContext = createMockActionContext()

    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
    vi.mocked(panel.webview.postMessage).mockClear()
    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "Welcome",
    })

    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.One, false)
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "Welcome" }),
      }),
    )
  })

  test("navigating the main panel leaves the side panel standing", async () => {
    const extensionContext = createMockContext()
    const extensionUri = vscode.Uri.file("/ext")
    const actionContext = createMockActionContext()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)

    createWebviewPanel.mockReturnValue(createFakeWebviewPanel().panel)
    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })

    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "Welcome",
    })

    expect(side.dispose).not.toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeDefined()
  })

  test("re-entering dispose tears the panel down only once", async () => {
    const { panel, dispose } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

    TmcPanel.renderMain(vscode.Uri.file("/ext"), createMockContext(), createMockActionContext(), {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
    const mainPanel = TmcPanel.mainPanel
    expect(mainPanel).toBeDefined()

    mainPanel?.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(TmcPanel.mainPanel).toBeUndefined()
  })
})

// Returns the document `TmcPanel`'s constructor hands the webview host.
async function mountedWebviewHtml(): Promise<string> {
  resetPanels()
  const { panel } = createFakeWebviewPanel()
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

  TmcPanel.renderMain(vscode.Uri.file("/ext"), createMockContext(), createMockActionContext(), {
    id: nextPanelId(),
    type: "MyCourses",
    courseDeadlines: {},
  })
  return panel.webview.html
}

function nonceOf(html: string): string {
  const nonce = /<meta property="csp-nonce" content="([^"]*)"/.exec(html)?.[1]
  if (nonce === undefined) {
    throw new Error("the document declares no csp-nonce")
  }
  return nonce
}

function contentSecurityPolicyOf(html: string): string {
  const policy = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/.exec(html)?.[1]
  if (policy === undefined) {
    throw new Error("the document declares no content security policy")
  }
  return policy
}

suite("TmcPanel webview document", () => {
  afterEach(resetPanels)

  test("gives every document its own unguessable nonce", async () => {
    const first = nonceOf(await mountedWebviewHtml())
    const second = nonceOf(await mountedWebviewHtml())

    expect(first).toMatch(/^[\w-]{32}$/)
    expect(second).not.toBe(first)
  })

  test("names no scheme-wide source, so no directive reaches an arbitrary host", async () => {
    const sources = contentSecurityPolicyOf(await mountedWebviewHtml())
      .split(";")
      .flatMap((directive) => directive.trim().split(/\s+/))

    expect(sources).not.toContain("https:")
    expect(sources).not.toContain("http:")
    expect(sources).not.toContain("*")
  })

  test("closes every script tag, so nothing after one is swallowed as its content", async () => {
    const html = await mountedWebviewHtml()

    const opened = html.match(/<script\b/g) ?? []
    expect(opened.length).toBeGreaterThan(0)
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(opened.length)
    expect(html.trimEnd().endsWith("</html>")).toBe(true)
  })

  test("nonces every script and stylesheet, which style-src and script-src require", async () => {
    const html = await mountedWebviewHtml()
    const nonce = nonceOf(html)

    const tags = html.match(/<(?:script|style|link)\b[^>]*>/g) ?? []
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
      expect(tag).toContain(`nonce="${nonce}"`)
    }
  })

  test("is granted only the directory the three files it loads live in", async () => {
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    await mountedWebviewHtml()

    const roots = createWebviewPanel.mock.calls[0]?.[3]?.localResourceRoots
    expect(roots?.map(String)).toEqual([
      String(vscode.Uri.joinPath(vscode.Uri.file("/ext"), "webview-ui/public/build")),
    ])
  })
})

function courseWith(exerciseCount: number, deadline: string | null = null) {
  return makeTmcKind({
    id: 42,
    name: "python-course",
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises: Array.from({ length: exerciseCount }, (_, index) => ({
      id: index + 1,
      availablePoints: 1,
      awardedPoints: 0,
      name: `part01-${String(index).padStart(3, "0")}_exercise`,
      deadline,
      passed: false,
      softDeadline: deadline,
    })),
    availablePoints: exerciseCount,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })
}

suite("TmcPanel requestCourseDetailsData exercise statuses", () => {
  const COURSE_ID = CourseIdentifier.from(42)
  // Large enough that one message per exercise would be obvious in the count.
  const EXERCISE_COUNT = 150

  async function openCourseDetails(
    exerciseCount: number,
    deadline: string | null = null,
  ): Promise<{
    posted: { type: string }[]
  }> {
    const course = courseWith(exerciseCount, deadline)
    const actionContext = createMockActionContext({
      startup: {
        langs: {
          getCourseDetails: vi.fn().mockResolvedValue(Ok({})),
        } as unknown as Langs,
        userData: { getCourse: () => Ok(course) } as never,
        workspaceManager: { getExercises: () => [] } as never,
      },
    })

    const { panel, listener } = await mountSidePanel(actionContext)
    await listener({
      type: "requestCourseDetailsData",
      requestId: 1,
      sourcePanel: {
        id: 5,
        type: "CourseDetails",
        courseId: COURSE_ID,
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })
    // The connectivity probe resolves on a later tick; let its continuation run.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    return {
      posted: vi.mocked(panel.webview.postMessage).mock.calls.map(([m]) => m as { type: string }),
    }
  }

  test("costs the same number of messages however many exercises the course has", async () => {
    const small = await openCourseDetails(1)
    const large = await openCourseDetails(EXERCISE_COUNT)

    expect(large.posted).toHaveLength(small.posted.length)
    expect(large.posted.filter((m) => m.type === "exerciseStatusChange")).toHaveLength(0)
  })

  test("ships only the fields the exercise contract declares", async () => {
    // The view model's rows also carry parsed `Date` deadlines it needs internally.
    // Those are not part of the message contract, and a `Date` has no business
    // crossing a `postMessage`.
    const { posted } = await openCourseDetails(1, "2030-01-01T00:00:00.000Z")

    const groups = posted.find((m) => m.type === "setCourseGroups") as unknown as {
      exerciseGroups: { exercises: Record<string, unknown>[] }[]
    }
    const exercise = groups.exerciseGroups[0]?.exercises[0]
    expect(exercise).toBeDefined()
    expect(Object.keys(exercise ?? {}).toSorted()).toEqual(
      Object.keys(ExerciseSchema.shape).toSorted(),
    )
  })

  test("reports every exercise's status in one message", async () => {
    const { posted } = await openCourseDetails(EXERCISE_COUNT)

    const statuses = posted.filter(
      (m): m is { type: string; courseId: unknown; statuses: unknown[] } =>
        m.type === "setExerciseStatuses",
    )
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.courseId).toEqual(COURSE_ID)
    expect(statuses[0]?.statuses).toHaveLength(EXERCISE_COUNT)
  })
})

suite("TmcPanel requestCourseDetailsData connectivity probe", () => {
  const COURSE_ID = CourseIdentifier.from(42)

  const sourcePanel = {
    id: 5,
    type: "CourseDetails" as const,
    courseId: COURSE_ID,
    exerciseStatuses: { tmc: {}, mooc: {} },
  }

  function contextProbing(
    getCourseDetails: ReturnType<typeof vi.fn>,
  ): ReturnType<typeof createMockActionContext> {
    return createMockActionContext({
      startup: {
        langs: { getCourseDetails } as unknown as Langs,
        userData: { getCourse: () => Ok(courseWith(2)) } as never,
        workspaceManager: { getExercises: () => [] } as never,
      },
    })
  }

  test("renders the course without waiting for the backend", async () => {
    // Never resolves, standing in for a slow or hanging CLI invocation.
    const actionContext = contextProbing(vi.fn().mockReturnValue(new Promise(() => {})))
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    const posted = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => m as { type: string })
    expect(posted.map((m) => m.type)).toEqual([
      "setCourseData",
      "setUpdateables",
      "setCourseDisabledStatus",
      "setExerciseStatuses",
      "setCourseGroups",
      "panelDataResult",
    ])
    expect(posted.at(-2)).toMatchObject({ offlineMode: false })
    // The answer goes out after the data the panel renders, and carries no error, so the
    // panel stops waiting on a request that was served rather than on its own timeout.
    expect(posted.at(-1)).toEqual({
      type: "panelDataResult",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      requestId: 1,
    })
  })

  test("corrects the view with one message when the backend is unreachable", async () => {
    const actionContext = contextProbing(
      vi.fn().mockResolvedValue(Err(new ConnectionError("down"))),
    )
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const posted = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => m as { type: string })
    const groups = posted.filter((m) => m.type === "setCourseGroups")
    expect(groups).toHaveLength(2)
    expect(groups[1]).toMatchObject({ offlineMode: true })
  })

  test("resends the course-details reply after the webview reloads", async () => {
    // A reload loses everything the panel was told; only what the host buffered
    // comes back, and a reply the host did not buffer is gone for good.
    const actionContext = contextProbing(vi.fn().mockResolvedValue(Ok({})))
    TmcPanel.sidePanel?.dispose()
    TmcPanel.sidePanel = undefined
    const { panel, getMessageListener } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)
    const courseDetails = {
      id: nextPanelId(),
      type: "CourseDetails" as const,
      courseId: COURSE_ID,
      exerciseStatuses: { tmc: {}, mooc: {} },
    }
    TmcPanel.renderSide(vscode.Uri.file("/ext"), createMockContext(), actionContext, courseDetails)
    const listener = getMessageListener()
    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel: courseDetails })
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => (m as { type: string }).type)
    expect(types).toContain("setPanel")
    expect(types).toContain("setCourseData")
    expect(types).toContain("setCourseGroups")
    // The reloaded webview asks again and its request ids start over, so an answer kept
    // from before the reload could settle a request it does not belong to.
    expect(types).not.toContain("panelDataResult")
  })

  test("leaves the deadlines standing when the backend answers with a failure", async () => {
    // Only an unreachable backend makes the stored deadlines untrustworthy; a reachable
    // one refusing the request says nothing about them.
    const actionContext = contextProbing(vi.fn().mockResolvedValue(Err(new ForbiddenError("no"))))
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const posted = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => m as { type: string })
    expect(posted.filter((m) => m.type === "setCourseGroups")).toHaveLength(1)
  })
})
