import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { removeCourse } from "../../actions/removeCourse"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { ExerciseStatus } from "../../api/workspaceManager"
import {
  BottleneckError,
  ConnectionError,
  ForbiddenError,
  InitializationError,
  presentationFor,
} from "../../errors"
import { postExerciseStatuses, postUpdateables } from "../../panels/exerciseLists"
import { exerciseStatusRegistry } from "../../panels/exerciseStatusRegistry"
import { moocLoginRegistry } from "../../panels/moocLoginRegistry"
import type { PanelActions } from "../../panels/panelActions"
import { registerPanelActions } from "../../panels/panelActions"
import type { PanelRoute } from "../../panels/routes"
import { nextPanelId, TmcPanel } from "../../panels/TmcPanel"
import { updateablesRegistry } from "../../panels/updateablesRegistry"
import type { LocalCourseData, LocalCourseExercise, Panel } from "../../shared/shared"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSchema,
  makeMoocKind,
  makeTmcKind,
  panelTarget,
} from "../../shared/shared"
import { Logger } from "../../utilities"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"
import { createMockContext } from "../mocks/vscode"
import { createFakeWebviewPanel } from "../support/webviewPanel"

// Course details render deadlines in `vscode.env.language`, and the mock ships no `env`.
beforeEach(() => {
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", { value: {}, writable: true, configurable: true })
})

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
      requestId: 1,
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

    await listener({ type: "moocLogin", requestId: 1, sourcePanel: loginPanel })

    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: loginPanel,
      requestId: 1,
      outcome: { ok: false, error: { message: "The extension did not initialize properly" } },
    })
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

    await listener({ type: "moocLogin", requestId: 2, sourcePanel: loginPanel })

    expect(replyTo(panel, 2)).toMatchObject({
      target: loginPanel,
      outcome: { ok: false, error: { message: "the CLI crashed" } },
    })
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
  })
})

// Mounts a fresh side panel (resetting any panel state a previous test left
// behind) and returns the fake webview panel + its captured message listener,
// so a test can post a message directly and inspect what got posted back.
async function mountSidePanel(
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext = createMockContext(),
  shownPanel?: PanelRoute,
): Promise<{
  panel: ReturnType<typeof createFakeWebviewPanel>["panel"]
  listener: (message: unknown) => Promise<void>
}> {
  TmcPanel.sidePanel?.dispose()
  TmcPanel.sidePanel = undefined

  const { panel, getMessageListener, sendReady } = createFakeWebviewPanel()
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

  const extensionUri = vscode.Uri.file("/ext")

  TmcPanel.renderSide(
    extensionUri,
    extensionContext,
    actionContext,
    shownPanel ?? { id: nextPanelId(), type: "MyCourses" },
  )
  await sendReady()
  const listener = getMessageListener()
  // Clear the initial mount's `setPanel` post so assertions below only see
  // what the handler under test itself posts.
  vi.mocked(panel.webview.postMessage).mockClear()

  return { panel, listener }
}

/** The `reply` to request `requestId` among what `panel` was sent. */
function replyTo(panel: vscode.WebviewPanel, requestId: number): unknown {
  return vi
    .mocked(panel.webview.postMessage)
    .mock.calls.map(([message]) => message as { type: string; requestId?: number })
    .find((message) => message.type === "reply" && message.requestId === requestId)
}

suite("TmcPanel initialization guards", () => {
  test("a panel waiting on data is told it is not coming, and nothing else is", async () => {
    // Nothing else ever answers `requestMyCoursesData`, so returning silently here
    // leaves the panel on its spinner for the rest of the session.
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const }

    await listener({ type: "requestMyCoursesData", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      requestId: 1,
      outcome: {
        ok: false,
        error: { message: expect.stringContaining("did not initialize properly") },
      },
    })
    expectNoNotification(actionContext)
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
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "no such course" } },
    })
  })

  test("a data request that throws is still answered, and reported as the bug it is", async () => {
    const actionContext = createMockActionContext({
      startup: {
        userData: {
          getCourse: () => {
            throw new Error("storage exploded")
          },
        } as never,
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "storage exploded" } },
    })
    expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Something went wrong while handling that action.",
      expect.objectContaining({ message: "storage exploded" }),
    )
  })

  test("a courses request without an exercise directory says why, in the panel alone", async () => {
    const actionContext = createMockActionContext({
      startup: {
        userData: { getCourses: () => [] } as never,
        resources: { projectsDirectory: undefined } as never,
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const }

    await listener({ type: "requestMyCoursesData", requestId: 3, sourcePanel })

    expect(replyTo(panel, 3)).toMatchObject({
      outcome: {
        ok: false,
        error: {
          message:
            "Showing your courses is unavailable: the TestMyCode tools did not report where the exercises folder is.",
        },
      },
    })
    expectNoNotification(actionContext)
  })

  test("a request served from stored data is answered without an error", async () => {
    const actionContext = createMockActionContext({
      startup: {
        userData: { getCourses: () => [] } as never,
        resources: { projectsDirectory: "/tmc" } as never,
      },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = { id: 5, type: "MyCourses" as const }

    await listener({ type: "requestMyCoursesData", requestId: 7, sourcePanel })

    expect(replyTo(panel, 7)).toEqual({
      type: "reply",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      requestId: 7,
      outcome: { ok: true },
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

    await listener({ type: "requestInitializationErrors", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: {
        ok: true,
        value: expect.objectContaining({
          initializationErrors: expect.objectContaining({
            tmc: expect.objectContaining({ error: "langs offline" }),
            userData: expect.objectContaining({ error: "corrupt user data" }),
          }),
        }),
      },
    })
  })

  test("a ready startup reports no initialization failures", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: {
        ok: true,
        value: expect.objectContaining({
          initializationErrors: {
            tmc: null,
            userData: null,
            workspaceManager: null,
            resources: null,
            exerciseDecorationProvider: null,
          },
        }),
      },
    })
  })

  test("a service absent from the failures map is reported as null, not empty or crashing", async () => {
    // Only `langs` failed; the root cause never touched the other four, which is
    // distinct from a service that ran and failed itself.
    const actionContext = createDegradedContext({ failures: { langs: new Error("langs offline") } })
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: {
        ok: true,
        value: expect.objectContaining({
          initializationErrors: expect.objectContaining({
            userData: null,
            workspaceManager: null,
            resources: null,
            exerciseDecorationProvider: null,
          }),
        }),
      },
    })
  })

  test("folds a failure's cause into the reported message", async () => {
    const actionContext = createDegradedContext({
      failures: { langs: new Error("langs offline", { cause: "network unreachable" }) },
    })
    const { panel, listener } = await mountSidePanel(actionContext, contextWithGlobalStorage())

    await listener({ type: "requestInitializationErrors", requestId: 1, sourcePanel })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: {
        ok: true,
        value: expect.objectContaining({
          initializationErrors: expect.objectContaining({
            tmc: expect.objectContaining({ error: "langs offline: network unreachable" }),
          }),
        }),
      },
    })
  })
})

// The panel layer cannot import `src/actions` or `src/commands` without recreating the
// runtime import cycle, so every one of those calls goes through this record instead.
function stubHandlers(): { [K in keyof PanelActions]: ReturnType<typeof vi.fn> } {
  return {
    closeExercises: vi.fn().mockResolvedValue(Err(new Error("could not close"))),
    downloadAndOpenExercises: vi
      .fn()
      .mockResolvedValue(Ok({ ids: [], exceededOpenLimit: undefined })),
    downloadExercisesForUi: vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    pasteExercise: vi.fn().mockResolvedValue(Ok("link")),
    refreshLocalExercises: vi.fn().mockResolvedValue(Ok.EMPTY),
    removeCourse: vi.fn().mockResolvedValue(Ok.EMPTY),
    sendSubmissionFeedback: vi.fn().mockResolvedValue(Ok.EMPTY),
    updateCourse: vi.fn().mockResolvedValue(Ok(true)),
  }
}

suite("TmcPanel handler dispatch", () => {
  test("closes exercises through the registered handler and reports its failure", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)
    const courseId = CourseIdentifier.from(42)
    const ids = [ExerciseIdentifier.from(101)]

    await listener({ type: "closeExercises", ids, courseId })

    expect(handlers.closeExercises).toHaveBeenCalledWith(actionContext, ids, courseId)
    expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to close the selected exercises.",
      expect.objectContaining({ message: "could not close" }),
      "tmc",
    )
  })

  test("reports a handler that rejects instead of dropping it", async () => {
    // The webview host discards whatever a listener rejects with, so nothing else
    // would tell the user their click failed.
    const handlers = stubHandlers()
    handlers.openWorkspace.mockRejectedValue(new Error("handler exploded"))
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Ok(courseWith(0)) } as never },
    })
    const { listener } = await mountSidePanel(actionContext)

    await listener({ type: "openCourseWorkspace", courseId: CourseIdentifier.from(42) })

    expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Something went wrong while handling that action.",
      expect.objectContaining({ message: "handler exploded" }),
    )
  })

  test("a course refresh rescans the exercises on disk before posting them", async () => {
    // `updateCourse` does not rescan, and the statuses posted next are read out of the
    // workspace manager.
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)

    await listener(refreshRequest(CourseIdentifier.from(42)))

    expect(handlers.refreshLocalExercises).toHaveBeenCalledWith(actionContext)
  })

  const pasteCourse = makeTmcKind({
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
  const pasteExercise = makeTmcKind({
    id: 101,
    name: "loops",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    passed: false,
    softDeadline: null,
  })

  /** Mounts test results for `course`'s `exercise` and asks them to paste it. */
  async function paste(
    actionContext: ActionContext,
    course: LocalCourseData = pasteCourse,
    exercise: LocalCourseExercise = pasteExercise,
  ): Promise<{ panel: vscode.WebviewPanel; shown: PanelRoute }> {
    const shown = { ...exerciseSubmissionPanel(), course, exercise } as PanelRoute
    const { panel, listener } = await mountSidePanel(actionContext, createMockContext(), shown)
    await listener({ type: "pasteExercise", requestId: 1, sourcePanel: panelTarget(shown) })
    return { panel, shown }
  }

  test("a paste link goes back to the panel that asked for it", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)

    const { panel, shown } = await paste(createMockActionContext())

    expect(handlers.pasteExercise).toHaveBeenCalledWith(
      expect.anything(),
      "tmc",
      "python-course",
      "loops",
    )
    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: panelTarget(shown),
      requestId: 1,
      outcome: { ok: true, value: "link" },
    })
  })

  test("pastes the exercise the host shows, and nothing a stale panel names", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const shown = exerciseSubmissionPanel()
    const { panel, listener } = await mountSidePanel(
      createMockActionContext(),
      createMockContext(),
      shown,
    )

    await listener({
      type: "pasteExercise",
      requestId: 1,
      sourcePanel: { id: 9999, type: "ExerciseSubmission" },
    })

    expect(handlers.pasteExercise).not.toHaveBeenCalled()
    expect(replyTo(panel, 1)).toMatchObject({ outcome: { ok: false } })
  })

  test("a mooc course's exercise is pasted through the mooc backend", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)

    await paste(
      createMockActionContext(),
      makeMoocKind({ ...pasteCourse.data, id: "course-uuid" }),
      makeMoocKind({ ...pasteExercise.data, id: "exercise-uuid" }),
    )

    expect(handlers.pasteExercise).toHaveBeenCalledWith(
      expect.anything(),
      "mooc",
      "python-course",
      "loops",
    )
  })

  test("a busy paste is answered in the panel alone, with the busy notice", async () => {
    const handlers = stubHandlers()
    handlers.pasteExercise.mockResolvedValue(
      Err(new BottleneckError("A paste is already running.")),
    )
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()

    const { panel } = await paste(actionContext)

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "A paste is already running." } },
    })
    expectNoNotification(actionContext)
  })

  test("a paste that throws still answers the waiting panel, and nothing else", async () => {
    const handlers = stubHandlers()
    handlers.pasteExercise.mockRejectedValue(new Error("paste exploded"))
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()

    const { panel } = await paste(actionContext)

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "paste exploded" } },
    })
    expectNoNotification(actionContext)
  })

  test("a failed paste is reported in the panel, and not also as a notification", async () => {
    // The panel that asked is on screen and renders the failure itself, so a toast
    // would be the second report of one failure.
    const handlers = stubHandlers()
    handlers.pasteExercise.mockResolvedValue(Err(new Error("paste service is down")))
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()

    const { panel } = await paste(actionContext)

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "paste service is down" } },
    })
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })
})

function expectNoNotification(actionContext: ActionContext): void {
  expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
  expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  expect(actionContext.dialog.notification).not.toHaveBeenCalled()
}

suite("TmcPanel reports a handler's failure once", () => {
  async function mountWith(
    handlers: ReturnType<typeof stubHandlers>,
    actionContext = createMockActionContext(),
  ): Promise<{
    actionContext: ReturnType<typeof createMockActionContext>
    panel: vscode.WebviewPanel
    listener: (message: unknown) => Promise<void>
  }> {
    registerPanelActions(handlers as unknown as PanelActions)
    const { panel, listener } = await mountSidePanel(actionContext)
    return { actionContext, panel, listener }
  }

  const courseId = CourseIdentifier.from(42)
  const ids = [ExerciseIdentifier.from(1)]

  suite("for removeCourse", () => {
    function confirmingContext(
      startup: Parameters<typeof createMockActionContext>[0] = {},
    ): ReturnType<typeof createMockActionContext> {
      const actionContext = createMockActionContext({
        ...startup,
        startup: {
          userData: {
            getCourse: () => Ok(courseWith(0)),
            deleteCourse: vi.fn(async () => Err(new Error("globalState is full"))),
          } as never,
          langs: { unsetSetting: vi.fn(async () => Ok.EMPTY) } as never,
          workspaceManager: { deleteWorkspaceFile: vi.fn(async () => Ok.EMPTY) } as never,
          ...startup.startup,
        },
      })
      vi.mocked(actionContext.dialog.confirm).mockResolvedValue(true)
      return actionContext
    }

    test("a removal that fails is reported once and never announced as done", async () => {
      const { actionContext, panel, listener } = await mountWith(
        { ...stubHandlers(), removeCourse: vi.fn(removeCourse) },
        confirmingContext(),
      )

      await listener({ type: "removeCourse", id: courseId })

      expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        'Failed to remove "python-course" from your courses.',
        expect.objectContaining({ message: "globalState is full" }),
        "tmc",
      )
      expect(actionContext.dialog.statusMessage).not.toHaveBeenCalled()
      expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "setPanel" }),
      )
    })

    test("asks in a modal dialog and removes nothing when the user cancels", async () => {
      const handlers = stubHandlers()
      const actionContext = confirmingContext()
      vi.mocked(actionContext.dialog.confirm).mockResolvedValue(false)
      const { listener } = await mountWith(handlers, actionContext)

      await listener({ type: "removeCourse", id: courseId })

      expect(actionContext.dialog.confirm).toHaveBeenCalledExactlyOnceWith(
        "Remove Python Course from your courses?",
        expect.objectContaining({ confirmLabel: "Remove Course" }),
      )
      expect(handlers.removeCourse).not.toHaveBeenCalled()
    })

    test("a removal that succeeds is announced and shows the remaining courses", async () => {
      const { actionContext, panel, listener } = await mountWith(
        stubHandlers(),
        confirmingContext(),
      )

      await listener({ type: "removeCourse", id: courseId })

      expect(actionContext.dialog.statusMessage).toHaveBeenCalledExactlyOnceWith(
        "Removed Python Course.",
      )
      expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setPanel",
          panel: expect.objectContaining({ type: "MyCourses" }),
        }),
      )
    })
  })

  test("for clearNewExercises", async () => {
    const error = new Error("globalState is full")
    const { actionContext, listener } = await mountWith(
      stubHandlers(),
      createMockActionContext({
        startup: { userData: { clearFromNewExercises: vi.fn(async () => Err(error)) } as never },
      }),
    )

    await listener({ type: "clearNewExercises", courseId })

    expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to dismiss the new exercises.",
      error,
      "tmc",
    )
  })

  test("for downloadExercises, when the download throws", async () => {
    const handlers = stubHandlers()
    handlers.downloadExercisesForUi.mockRejectedValue(new Error("disk full"))
    const { actionContext, listener } = await mountWith(handlers)

    await listener({ type: "downloadExercises", mode: "download", courseId, ids })

    expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to download the exercises.",
      expect.objectContaining({ message: "disk full" }),
      "tmc",
    )
  })

  suite("for openExercises", () => {
    test("a failed open", async () => {
      const handlers = stubHandlers()
      const error = new Error("tmc-langs crashed")
      handlers.downloadAndOpenExercises.mockResolvedValue(Err(error))
      const { actionContext, listener } = await mountWith(handlers)

      await listener({ type: "openExercises", ids, courseId })

      expect(actionContext.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        "Failed to open the selected exercises.",
        error,
        "tmc",
      )
      expect(actionContext.dialog.warningNotification).not.toHaveBeenCalled()
    })

    test("warns about the open-exercise limit the operation reports exceeded", async () => {
      const handlers = stubHandlers()
      handlers.downloadAndOpenExercises.mockResolvedValue(Ok({ ids, exceededOpenLimit: 50 }))
      const renderMain = vi.spyOn(TmcPanel, "renderMain").mockImplementation(() => {})
      onTestFinished(() => renderMain.mockRestore())
      const { actionContext, listener } = await mountWith(handlers)

      await listener({ type: "openExercises", ids, courseId })

      expect(actionContext.dialog.warningNotification).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("over 50 exercises open"),
        ["Open course details", expect.any(Function)],
      )
      // Course Details is where Close lives, and the button below goes there.
      const [warning] = vi.mocked(actionContext.dialog.warningNotification).mock.calls[0] ?? []
      expect(warning).toContain("in Course Details")
      const [, [, openCourseDetails]] = vi.mocked(actionContext.dialog.warningNotification).mock
        .calls[0] as [string, [string, () => void]]
      openCourseDetails()
      expect(renderMain).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        actionContext,
        expect.objectContaining({ type: "CourseDetails", courseId }),
      )
    })

    test("says nothing about a limit that was not exceeded", async () => {
      const { actionContext, listener } = await mountWith(stubHandlers())

      await listener({ type: "openExercises", ids, courseId })

      expect(actionContext.dialog.warningNotification).not.toHaveBeenCalled()
      expectNoNotification(actionContext)
    })
  })

  test("for refreshCourseDetails, in the panel that asked", async () => {
    const handlers = stubHandlers()
    handlers.updateCourse.mockResolvedValue(Err(new Error("tmc-langs crashed")))
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = courseDetailsContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener(refreshRequest(courseId, shown))

    expectNoNotification(actionContext)
    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: { id: shown.id, type: "CourseDetails" },
      requestId: 1,
      outcome: { ok: false, error: { message: "tmc-langs crashed" } },
    })
  })
})

// A webview mounted before a failed (or since-degraded) activation can still post any
// of these messages; each must be answered rather than silently dropped.
suite("TmcPanel handler dispatch, degraded startup", () => {
  const UNAVAILABLE_ACTION = "This action is unavailable."

  test("closeExercises reports the failure instead of calling the handler", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
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
    registerPanelActions(handlers as unknown as PanelActions)
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
    registerPanelActions(handlers as unknown as PanelActions)
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

  test("refreshCourseDetails tells the waiting panel why, and re-renders nothing", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createDegradedContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener(refreshRequest(CourseIdentifier.from(42), shown))

    expect(handlers.updateCourse).not.toHaveBeenCalled()
    expect(handlers.refreshLocalExercises).not.toHaveBeenCalled()
    expectNoNotification(actionContext)
    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "The extension did not initialize properly" } },
    })
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "setPanel" }),
    )
  })

  test("pasteExercise answers the waiting panel, and nothing else", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createDegradedContext()
    const shown = exerciseSubmissionPanel()
    const { panel, listener } = await mountSidePanel(actionContext, createMockContext(), shown)

    await listener({ type: "pasteExercise", requestId: 1, sourcePanel: panelTarget(shown) })

    expect(handlers.pasteExercise).not.toHaveBeenCalled()
    expectNoNotification(actionContext)
    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: panelTarget(shown),
      requestId: 1,
      outcome: { ok: false, error: { message: "The extension did not initialize properly" } },
    })
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
    registerPanelActions(handlers as unknown as PanelActions)
    const { panel, listener } = await mountSidePanel(createMockActionContext())
    await listener(message)
    return { handlers, posted: vi.mocked(panel.webview.postMessage) }
  }

  const courseId = CourseIdentifier.from(42)
  const ids = [ExerciseIdentifier.from(101)]

  test("ignores a message whose type it does not know", async () => {
    const { handlers, posted } = await drive({ type: "notAKnownMessage", ids, courseId })

    expect(handlers.closeExercises).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("ignores a known message that is missing a required field", async () => {
    const { handlers, posted } = await drive({ type: "closeExercises", ids })

    expect(handlers.closeExercises).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("acts on the same message once it carries the field", async () => {
    const { handlers } = await drive({ type: "closeExercises", ids, courseId })

    expect(handlers.closeExercises).toHaveBeenCalledWith(expect.anything(), ids, courseId)
  })
})

suite("TmcPanel webview-supplied paths and links", () => {
  test("resolves the workspace slug from storage rather than from the message", async () => {
    // The slug becomes a `.code-workspace` path the extension writes and opens, so a
    // name the webview chose must never reach it.
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
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
    // A stale _route is the way this feature makes things worse than the bug it
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

    const lastPanel = (TmcPanel.sidePanel as unknown as { _route: { id: number } })._route
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

    const lastPanel = (TmcPanel.sidePanel as unknown as { _route: { id: number } })._route
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

  test("renders a new panel once, when its document says it is ready", async () => {
    resetPanels()
    const { panel, sendReady } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)
    const courseDetails = {
      id: nextPanelId(),
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
    }
    renderMainPanel(courseDetails)
    TmcPanel.postMessage({
      type: "setCourseGroups",
      target: { id: courseDetails.id, type: "CourseDetails" },
      offlineMode: false,
      exerciseGroups: [],
    })

    expect(panel.webview.postMessage).not.toHaveBeenCalled()

    await sendReady()

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel", "setCourseGroups"])
  })

  test("a webview that has rendered nothing gets nothing resent", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    ;(TmcPanel.sidePanel as unknown as { _route: undefined })._route = undefined

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
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "setUpdateables", exerciseIds: [] }),
    )
  })
})

suite("TmcPanel in-flight downloads", () => {
  afterEach(() => exerciseStatusRegistry.clear())

  test("a course opened mid-download shows the download, not a Download button", async () => {
    const courseId = CourseIdentifier.from(42)
    postExerciseStatuses(courseId, [[ExerciseIdentifier.from(1), "downloading"]])
    const { panel, listener, shown } = await mountCourseDetails(courseDetailsContext())

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel: shown })

    const { statuses } = lastMessageOf(panel, "setExerciseStatuses") as {
      statuses: [ExerciseIdentifier, string][]
    }
    expect(statuses[0]).toEqual([ExerciseIdentifier.from(1), "downloading"])
  })

  test("a failed download stays failed, until the exercise is on disk after all", async () => {
    const courseId = CourseIdentifier.from(42)
    postExerciseStatuses(courseId, [
      [ExerciseIdentifier.from(1), "downloadFailed"],
      [ExerciseIdentifier.from(2), "downloadFailed"],
    ])
    const actionContext = courseDetailsContext()
    const onDisk = {
      backend: "tmc",
      courseSlug: "python-course",
      exerciseSlug: "part01-001_exercise",
      status: ExerciseStatus.Closed,
    }
    actionContext.startup.workspaceManager = { getExercises: () => [onDisk] } as never
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel: shown })

    expect(lastMessageOf(panel, "setExerciseStatuses")).toMatchObject({
      statuses: [
        [ExerciseIdentifier.from(1), "downloadFailed"],
        [ExerciseIdentifier.from(2), "closed"],
      ],
    })
  })

  test("a second download of the same course is turned away while one runs", async () => {
    const handlers = stubHandlers()
    const download = Promise.withResolvers<void>()
    handlers.downloadExercisesForUi.mockReturnValue(download.promise)
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()
    const { listener } = await mountSidePanel(actionContext)
    const downloadMessage = {
      type: "downloadExercises",
      mode: "download",
      courseId: CourseIdentifier.from(42),
      ids: [ExerciseIdentifier.from(1)],
    }

    const first = listener(downloadMessage)
    await listener(downloadMessage)
    download.resolve()
    await first

    expect(handlers.downloadExercisesForUi).toHaveBeenCalledTimes(1)
    expect(actionContext.dialog.notification).toHaveBeenCalledWith(
      "This course's exercises are already downloading.",
    )
  })
})

// A ready context whose stored course 42 and workspace the CourseDetails handlers can read.
function courseDetailsContext(): ReturnType<typeof createMockActionContext> {
  return createMockActionContext({
    startup: {
      langs: { getCourseDetails: vi.fn().mockResolvedValue(Ok({})) } as unknown as Langs,
      userData: { getCourse: () => Ok(courseWith(2)) } as never,
      workspaceManager: { getExercises: () => [] } as never,
    },
  })
}

async function mountCourseDetails(actionContext: ActionContext): Promise<{
  panel: vscode.WebviewPanel
  listener: (message: unknown) => Promise<void>
  shown: CourseDetailsRoute
}> {
  const shown: CourseDetailsRoute = {
    id: nextPanelId(),
    type: "CourseDetails",
    courseId: CourseIdentifier.from(42),
  }
  const { panel, listener } = await mountSidePanel(actionContext, createMockContext(), shown)
  return { panel, listener, shown }
}

type CourseDetailsRoute = Extract<PanelRoute, { type: "CourseDetails" }>

/** A `refreshCourseDetails` request with id 1, from `sourcePanel` or else panel 1. */
function refreshRequest(
  courseId: CourseIdentifier,
  sourcePanel?: { id: number },
): { type: "refreshCourseDetails"; requestId: 1; sourcePanel: object; id: CourseIdentifier } {
  return {
    type: "refreshCourseDetails",
    requestId: 1,
    sourcePanel: { id: sourcePanel?.id ?? 1, type: "CourseDetails" },
    id: courseId,
  }
}

function postedMessages(panel: vscode.WebviewPanel): { type: string }[] {
  return vi.mocked(panel.webview.postMessage).mock.calls.map(([m]) => m as { type: string })
}

function lastMessageOf(panel: vscode.WebviewPanel, type: string): unknown {
  return postedMessages(panel)
    .filter((m) => m.type === type)
    .at(-1)
}

suite("TmcPanel refreshCourseDetails", () => {
  test("refreshes the panel in place, then says the refresh is over", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = courseDetailsContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener(refreshRequest(shown.courseId, shown))

    const posted = postedMessages(panel)
    // A new panel id would remount it, losing the student's selection and scroll.
    expect(posted.map((m) => m.type)).not.toContain("setPanel")
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "setCourseGroups", target: panelTarget(shown) }),
    )
    expect(posted.at(-1)).toEqual({
      type: "reply",
      target: panelTarget(shown),
      requestId: 1,
      outcome: { ok: true },
    })
  })

  test("does not pull the student back to a course they navigated away from", async () => {
    const handlers = stubHandlers()
    const update = Promise.withResolvers<unknown>()
    handlers.updateCourse.mockReturnValue(update.promise)
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = courseDetailsContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    const refreshing = listener(refreshRequest(shown.courseId, shown))
    await listener({ type: "openMyCourses" })
    vi.mocked(panel.webview.postMessage).mockClear()
    update.resolve(Ok(true))
    await refreshing

    // The reply still goes out, to a panel id the webview no longer shows.
    expect(postedMessages(panel).map((m) => m.type)).toEqual(["reply"])
  })

  test("answers the panel even when the refresh throws", async () => {
    const handlers = stubHandlers()
    handlers.refreshLocalExercises.mockRejectedValue(new Error("rescan exploded"))
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = courseDetailsContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener(refreshRequest(CourseIdentifier.from(42), shown))

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "rescan exploded" } },
    })
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

suite("TmcPanel host services for the webview", () => {
  test("copies text through VS Code's clipboard and tells the panel it did", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    ;(vscode as unknown as { env: unknown }).env = { clipboard: { writeText } }
    const shown = exerciseSubmissionPanel()
    const { panel, listener } = await mountSidePanel(
      createMockActionContext(),
      createMockContext(),
      shown,
    )

    await listener({
      type: "copyToClipboard",
      requestId: 1,
      sourcePanel: panelTarget(shown),
      text: "Traceback (most recent call last)",
    })

    expect(writeText).toHaveBeenCalledWith("Traceback (most recent call last)")
    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: panelTarget(shown),
      requestId: 1,
      outcome: { ok: true },
    })
  })

  test("says so when the clipboard refuses the text", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no clipboard"))
    ;(vscode as unknown as { env: unknown }).env = { clipboard: { writeText } }
    const shown = exerciseSubmissionPanel()
    const { panel, listener } = await mountSidePanel(
      createMockActionContext(),
      createMockContext(),
      shown,
    )

    await listener({
      type: "copyToClipboard",
      requestId: 1,
      sourcePanel: panelTarget(shown),
      text: "x",
    })

    expect(replyTo(panel, 1)).toMatchObject({
      outcome: { ok: false, error: { message: "no clipboard" } },
    })
  })

  const feedbackPanel = { id: 31, type: "ExerciseSubmission" as const }

  test("hands feedback answers to the feedback action and says it went", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    const answers = [{ questionId: 3, answer: "4" }]

    await listener({
      type: "sendFeedback",
      requestId: 1,
      sourcePanel: feedbackPanel,
      feedbackAnswerUrl: "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback",
      answers,
    })

    expect(handlers.sendSubmissionFeedback).toHaveBeenCalledWith(
      actionContext,
      "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback",
      answers,
    )
    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: feedbackPanel,
      requestId: 1,
      outcome: { ok: true },
    })
  })

  test("reports a feedback failure to the form that sent it", async () => {
    const handlers = stubHandlers()
    handlers.sendSubmissionFeedback.mockResolvedValue(Err(new Error("server said no")))
    registerPanelActions(handlers as unknown as PanelActions)
    const { panel, listener } = await mountSidePanel(createMockActionContext())

    await listener({
      type: "sendFeedback",
      requestId: 1,
      sourcePanel: feedbackPanel,
      feedbackAnswerUrl: "https://tmc.mooc.fi/feedback",
      answers: [],
    })

    expect(replyTo(panel, 1)).toEqual({
      type: "reply",
      target: feedbackPanel,
      requestId: 1,
      outcome: { ok: false, error: { message: "server said no" } },
    })
  })

  test("logs a webview crash at error level", async () => {
    const error = vi.spyOn(Logger, "error").mockImplementation(() => {})
    onTestFinished(() => error.mockRestore())
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "webviewError", message: "boom", stack: "at App.svelte:1" })

    expect(error).toHaveBeenCalledWith(expect.stringContaining("boom"), "at App.svelte:1")
  })

  test.each([
    ["tmc.logs", []],
    ["tmc.myCourses", []],
    ["tmc.showMoocLogin", []],
    ["workbench.action.restartExtensionHost", []],
    ["workbench.action.openSettings", ["testMyCode.logLevel"]],
    ["workbench.action.openIssueReporter", [{ extensionId: "moocfi.test-my-code" }]],
  ])("runs %s with the arguments the host chooses", async (command, args) => {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "runCommand", command })

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(command, ...args)
  })

  test("runs no command outside the allow-list", async () => {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "runCommand", command: "tmc.wipe" })

    expect(executeCommand).not.toHaveBeenCalled()
  })
})

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
    const { panel, dispose, sendReady } = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(panel)

    const extensionContext = createMockContext()
    const extensionUri = vscode.Uri.file("/ext")
    const actionContext = createMockActionContext()

    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
    })
    await sendReady()
    vi.mocked(panel.webview.postMessage).mockClear()
    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })

    expect(createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    // `undefined` keeps the panel in whichever column the user moved it to.
    expect(panel.reveal).toHaveBeenCalledWith(undefined, false)
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "InitializationErrorHelp" }),
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
    })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
    })

    TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })

    expect(side.dispose).not.toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeDefined()
  })

  test("closing the main panel leaves the side panel standing", async () => {
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockReturnValue(createFakeWebviewPanel().panel)
    renderMainPanel({ id: nextPanelId(), type: "MyCourses" })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    renderSidePanel({ id: nextPanelId(), type: "MyCourses" })

    TmcPanel.mainPanel?.dispose()

    expect(side.dispose).not.toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeDefined()
  })

  test("re-entering dispose tears the panel down only once", async () => {
    const { panel, dispose } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

    TmcPanel.renderMain(vscode.Uri.file("/ext"), createMockContext(), createMockActionContext(), {
      id: nextPanelId(),
      type: "MyCourses",
    })
    const mainPanel = TmcPanel.mainPanel
    expect(mainPanel).toBeDefined()

    mainPanel?.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(TmcPanel.mainPanel).toBeUndefined()
  })
})

function renderMainPanel(panel: PanelRoute): void {
  TmcPanel.renderMain(
    vscode.Uri.file("/ext"),
    createMockContext(),
    createMockActionContext(),
    panel,
  )
}

function renderSidePanel(panel: PanelRoute): void {
  TmcPanel.renderSide(
    vscode.Uri.file("/ext"),
    createMockContext(),
    createMockActionContext(),
    panel,
  )
}

suite("TmcPanel side panel placement", () => {
  beforeEach(resetPanels)
  afterEach(resetPanels)

  test("opens submission results beside the editor without taking its focus", () => {
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(createFakeWebviewPanel().panel)

    renderSidePanel(exerciseSubmissionPanel())

    expect(createWebviewPanel).toHaveBeenCalledWith(
      "sidePanel",
      expect.any(String),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      expect.anything(),
    )
  })

  test("re-shows submission results where the user left them, still without focus", () => {
    const { panel } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)
    renderSidePanel(exerciseSubmissionPanel())

    renderSidePanel(exerciseSubmissionPanel())

    expect(panel.reveal).toHaveBeenCalledExactlyOnceWith(undefined, true)
  })

  test("focuses the login panel the user opened", () => {
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(createFakeWebviewPanel().panel)

    renderSidePanel({ id: nextPanelId(), type: "MoocLogin" })

    expect(createWebviewPanel).toHaveBeenCalledWith(
      "sidePanel",
      expect.any(String),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      expect.anything(),
    )
  })
})

suite("TmcPanel tab identity", () => {
  beforeEach(resetPanels)
  afterEach(resetPanels)

  function mainPanelTitleFor(
    panel: PanelRoute,
    actionContext: ActionContext = createMockActionContext(),
  ): string {
    resetPanels()
    const { panel: webviewPanel } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(webviewPanel)
    TmcPanel.renderMain(vscode.Uri.file("/ext"), createMockContext(), actionContext, panel)
    return webviewPanel.title
  }

  test("names each screen instead of calling every tab TestMyCode", () => {
    expect(mainPanelTitleFor({ id: nextPanelId(), type: "MyCourses" })).toBe("My Courses")
    expect(mainPanelTitleFor({ id: nextPanelId(), type: "InitializationErrorHelp" })).toBe(
      "TestMyCode Help",
    )
    expect(mainPanelTitleFor({ id: nextPanelId(), type: "MoocLogin" })).toBe("Log In")
  })

  test("titles a course's tab with the course title, not its slug", () => {
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Ok(courseWith(0)) } as never },
    })
    const title = mainPanelTitleFor(
      {
        id: nextPanelId(),
        type: "CourseDetails",
        courseId: CourseIdentifier.from(42),
      },
      actionContext,
    )

    expect(title).toBe("Python Course")
  })

  test("names the exercise a results tab belongs to", () => {
    const exercise = makeTmcKind({
      id: 1,
      name: "part01-01_hello",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    })

    const title = mainPanelTitleFor({
      id: nextPanelId(),
      type: "ExerciseSubmission",
      course: courseWith(1),
      exercise,
    })

    expect(title).toBe("Submission: part01-01_hello")
  })

  test("retitles a reused tab when it navigates", () => {
    const { panel } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)
    renderMainPanel({ id: nextPanelId(), type: "InitializationErrorHelp" })

    renderMainPanel({ id: nextPanelId(), type: "MyCourses" })

    expect(panel.title).toBe("My Courses")
  })

  test("carries the extension's icon for both theme kinds, and a find widget", () => {
    const { panel } = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(panel)

    renderMainPanel({ id: nextPanelId(), type: "InitializationErrorHelp" })

    expect(panel.iconPath).toEqual({
      light: vscode.Uri.joinPath(vscode.Uri.file("/ext"), "media", "TMC-light.svg"),
      dark: vscode.Uri.joinPath(vscode.Uri.file("/ext"), "media", "TMC.svg"),
    })
    expect(createWebviewPanel.mock.calls[0]?.[3]).toMatchObject({ enableFindWidget: true })
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

function exerciseSubmissionPanel(): Extract<Panel, { type: "ExerciseSubmission" }> {
  return {
    id: nextPanelId(),
    type: "ExerciseSubmission",
    course: courseWith(1),
    exercise: makeTmcKind({
      id: 1,
      name: "part01-01_hello",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    }),
  }
}

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

  test("renders deadlines in VS Code's display language", async () => {
    const deadline = "2030-01-01T00:00:00.000Z"
    ;(vscode as unknown as { env: unknown }).env = { language: "fi" }
    const { posted } = await openCourseDetails(1, deadline)

    const groups = posted.find((m) => m.type === "setCourseGroups") as unknown as {
      exerciseGroups: { exercises: { hardDeadlineString: string }[] }[]
    }
    expect(groups.exerciseGroups[0]?.exercises[0]?.hardDeadlineString).toBe(
      new Intl.DateTimeFormat("fi", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(deadline),
      ),
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
      "reply",
    ])
    expect(posted.at(-2)).toMatchObject({ offlineMode: false })
    // The answer goes out after the data the panel renders, and carries no error, so the
    // panel stops waiting on a request that was served rather than on its own timeout.
    expect(posted.at(-1)).toEqual({
      type: "reply",
      target: { id: sourcePanel.id, type: sourcePanel.type },
      requestId: 1,
      outcome: { ok: true },
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
    expect(types).not.toContain("reply")
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
