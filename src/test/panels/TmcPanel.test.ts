import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import { BottleneckError, InitializationError, presentationFor } from "../../errors"
import type { PanelActions } from "../../panels/panelActions"
import { registerPanelActions } from "../../panels/panelActions"
import type { PanelRoute } from "../../panels/routes"
import { nextPanelId, TmcPanel } from "../../panels/TmcPanel"
import type {
  ExtensionToWebview,
  LocalCourseData,
  LocalCourseExercise,
  Panel,
} from "../../shared/shared"
import { CourseIdentifier, makeMoocKind, makeTmcKind, panelTarget } from "../../shared/shared"
import { Logger } from "../../utilities"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"
import { createMockContext } from "../mocks/vscode"
import { createFakeWebviewPanel } from "../support/webviewPanel"

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
    shownPanel ?? { id: nextPanelId(), type: "InitializationErrorHelp" },
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
    // Nothing else ever answers `requestCourseDetailsData`, so returning silently here
    // leaves the panel on its spinner for the rest of the session.
    const actionContext = createDegradedContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
    }

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel })

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

  test("a request served from stored data is answered without an error", async () => {
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Ok(courseWith(0)) } as never },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    const sourcePanel = {
      id: 5,
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
    }

    await listener({ type: "requestCourseDetailsData", requestId: 7, sourcePanel })

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

    await listener({ type: "openCourseWorkspace", courseId: CourseIdentifier.from(1) })

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
    keepWaitingForGrading: vi.fn().mockResolvedValue(Ok.EMPTY),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    pasteExercise: vi.fn().mockResolvedValue(Ok("link")),
    refreshLocalExercises: vi.fn().mockResolvedValue(Ok.EMPTY),
    sendSubmissionFeedback: vi.fn().mockResolvedValue(Ok.EMPTY),
    updateCourse: vi.fn().mockResolvedValue(Ok(true)),
  }
}

suite("TmcPanel handler dispatch", () => {
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

  test("a course refresh rescans the exercises on disk", async () => {
    // `updateCourse` does not rescan, and the Courses view shows what is on disk.
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
  const courseId = CourseIdentifier.from(42)

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
    const actionContext = createMockActionContext({
      startup: { userData: { getCourse: () => Ok(courseWith(0)) } as never },
    })
    const { panel, listener } = await mountSidePanel(actionContext)
    await listener(message)
    return { handlers, posted: vi.mocked(panel.webview.postMessage) }
  }

  const courseId = CourseIdentifier.from(42)

  test("ignores a message whose type it does not know", async () => {
    const { handlers, posted } = await drive({ type: "notAKnownMessage", courseId })

    expect(handlers.openWorkspace).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("ignores a known message that is missing a required field", async () => {
    const { handlers, posted } = await drive({ type: "openCourseWorkspace" })

    expect(handlers.openWorkspace).not.toHaveBeenCalled()
    expect(posted).not.toHaveBeenCalled()
  })

  test("acts on the same message once it carries the field", async () => {
    const { handlers } = await drive({ type: "openCourseWorkspace", courseId })

    expect(handlers.openWorkspace).toHaveBeenCalledWith(expect.anything(), "python-course", "tmc")
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

suite("TmcPanel ready handshake", () => {
  test("resends the last rendered panel", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "ready" })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "InitializationErrorHelp" }),
      }),
    )
  })

  test("resends whichever panel was rendered last, not the one mounted with", async () => {
    // A stale _route is the way this feature makes things worse than the bug it
    // fixes, so every render path has to keep it current.
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    TmcPanel.renderSide(vscode.Uri.file("/ext"), createMockContext(), actionContext, {
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: makeTmcKind({ courseId: 1 }),
    })
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
    const { panel, listener, shown } = await mountCourseDetails(createMockActionContext())

    TmcPanel.postMessage(courseDataFor(shown))
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel", "setCourseData"])
  })

  test("does not replay a message aimed at a panel that is no longer shown", async () => {
    const { panel, listener } = await mountCourseDetails(createMockActionContext())

    // an id that was never rendered here; buffering it would resend it to a panel
    // that cannot interpret it
    TmcPanel.postMessage(courseDataFor({ id: 9999 }))
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel"])
  })

  test("rendering a new panel drops the previous panel's buffered messages", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    TmcPanel.postMessage(courseDataFor(shown))
    TmcPanel.renderSide(vscode.Uri.file("/ext"), createMockContext(), actionContext, {
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: makeTmcKind({ courseId: 1 }),
    })
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
    TmcPanel.postMessage(courseDataFor(courseDetails))

    expect(panel.webview.postMessage).not.toHaveBeenCalled()

    await sendReady()

    const types = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([message]) => (message as { type: string }).type)
    expect(types).toEqual(["setPanel", "setCourseData"])
  })

  test("a webview that has rendered nothing gets nothing resent", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)
    ;(TmcPanel.sidePanel as unknown as { _route: undefined })._route = undefined

    await listener({ type: "ready" })

    expect(panel.webview.postMessage).not.toHaveBeenCalled()
  })
})

/** A `submissionView` for `panel` whose headline is `headline`. */
function submissionViewFor(panel: { id: number }, headline: string): ExtensionToWebview {
  return {
    type: "submissionView",
    target: { id: panel.id, type: "ExerciseSubmission" },
    view: {
      phase: "grading",
      headline,
      progressSteps: [],
      testCases: [],
      canKeepWaiting: false,
      canPaste: false,
    },
  }
}

suite("TmcPanel hidden webviews", () => {
  beforeEach(resetPanels)
  afterEach(resetPanels)

  function mountHideable(route: PanelRoute): ReturnType<typeof createFakeWebviewPanel> {
    const fake = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(fake.panel)
    renderSidePanel(route)
    return fake
  }

  test("does not keep a hidden webview's document alive", () => {
    mountHideable(exerciseSubmissionPanel())

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls[0]?.[3]).not.toHaveProperty(
      "retainContextWhenHidden",
    )
  })

  test("posts nothing while hidden, then re-renders the latest submission view on reveal", async () => {
    const shown = exerciseSubmissionPanel()
    const { panel, sendReady, hide, reveal } = mountHideable(shown)
    await sendReady()
    TmcPanel.postMessage(submissionViewFor(shown, "Sending submission…"))
    hide()
    vi.mocked(panel.webview.postMessage).mockClear()

    TmcPanel.postMessage(submissionViewFor(shown, "Processing submission…"))
    TmcPanel.postMessage(submissionViewFor(shown, "Exercise graded"))
    expect(panel.webview.postMessage).not.toHaveBeenCalled()

    await reveal()

    expect(postedMessages(panel)).toEqual([
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ id: shown.id }),
      }),
      submissionViewFor(shown, "Exercise graded"),
    ])
  })

  test("drops the reply to a request its hidden document made", async () => {
    const copied = Promise.withResolvers<void>()
    const writeText = vi.fn(() => copied.promise)
    ;(vscode as unknown as { env: unknown }).env = { clipboard: { writeText } }
    const shown = exerciseSubmissionPanel()
    const { panel, sendReady, getMessageListener, hide, reveal } = mountHideable(shown)
    await sendReady()
    const copy = getMessageListener()({
      type: "copyToClipboard",
      requestId: 7,
      sourcePanel: panelTarget(shown),
      text: "stack trace",
    })
    hide()
    vi.mocked(panel.webview.postMessage).mockClear()

    copied.resolve()
    await copy
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    await reveal()

    expect(replyTo(panel, 7)).toBeUndefined()
    expect(postedMessages(panel).map(({ type }) => type)).toEqual(["setPanel"])
  })

  test("re-renders Course Details with the course it last had", async () => {
    const shown = {
      id: nextPanelId(),
      type: "CourseDetails" as const,
      courseId: CourseIdentifier.from(42),
    }
    const { panel, sendReady, hide, reveal } = mountHideable(shown)
    await sendReady()
    hide()
    TmcPanel.postMessage(courseDataFor(shown))
    vi.mocked(panel.webview.postMessage).mockClear()

    await reveal()

    expect(postedMessages(panel)).toEqual([
      expect.objectContaining({ type: "setPanel", panel: shown }),
      courseDataFor(shown),
    ])
  })
})

/** A `setCourseData` addressed to `panel`. */
function courseDataFor(panel: { id: number }): ExtensionToWebview {
  return {
    type: "setCourseData",
    target: { id: panel.id, type: "CourseDetails" },
    courseData: courseWith(0),
  }
}

// A ready context whose stored course 42 the CourseDetails handlers can read.
function courseDetailsContext(): ReturnType<typeof createMockActionContext> {
  return createMockActionContext({
    startup: { userData: { getCourse: () => Ok(courseWith(2)) } as never },
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

suite("TmcPanel refreshCourseDetails", () => {
  test("refreshes the panel in place, then says the refresh is over", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = courseDetailsContext()
    const { panel, listener, shown } = await mountCourseDetails(actionContext)

    await listener(refreshRequest(shown.courseId, shown))

    const posted = postedMessages(panel)
    // A new panel id would remount it, losing the student's scroll.
    expect(posted.map((m) => m.type)).not.toContain("setPanel")
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "setCourseData", target: panelTarget(shown) }),
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
    TmcPanel.renderSide(vscode.Uri.file("/ext"), createMockContext(), actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })
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

  test("keeps waiting for the grading of the submission the host shows", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const actionContext = createMockActionContext()
    const shown = exerciseSubmissionPanel()
    const { panel, listener } = await mountSidePanel(actionContext, createMockContext(), shown)

    await listener({ type: "keepWaitingForGrading", requestId: 1, sourcePanel: panelTarget(shown) })

    expect(handlers.keepWaitingForGrading).toHaveBeenCalledWith(
      expect.anything(),
      actionContext,
      shown.id,
    )
    expect(replyTo(panel, 1)).toMatchObject({ outcome: { ok: true } })
  })

  test("does not wait for a submission a stale panel names", async () => {
    const handlers = stubHandlers()
    registerPanelActions(handlers as unknown as PanelActions)
    const { panel, listener } = await mountSidePanel(
      createMockActionContext(),
      createMockContext(),
      exerciseSubmissionPanel(),
    )

    await listener({
      type: "keepWaitingForGrading",
      requestId: 1,
      sourcePanel: { id: 9999, type: "ExerciseSubmission" },
    })

    expect(handlers.keepWaitingForGrading).not.toHaveBeenCalled()
    expect(replyTo(panel, 1)).toMatchObject({ outcome: { ok: false } })
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
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
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
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
    })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
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
    renderMainPanel({
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
    })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    renderSidePanel({
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
    })

    TmcPanel.mainPanel?.dispose()

    expect(side.dispose).not.toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeDefined()
  })

  test("re-entering dispose tears the panel down only once", async () => {
    const { panel, dispose } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

    TmcPanel.renderMain(vscode.Uri.file("/ext"), createMockContext(), createMockActionContext(), {
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
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
      "tmc.sidePanel",
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
    expect(mainPanelTitleFor({ id: nextPanelId(), type: "InitializationErrorHelp" })).toBe(
      "TestMyCode Help",
    )
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

    renderMainPanel({
      id: nextPanelId(),
      type: "CourseDetails",
      courseId: CourseIdentifier.from(42),
    })

    expect(panel.title).toBe("Course Details")
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
    type: "CourseDetails",
    courseId: CourseIdentifier.from(42),
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

suite("TmcPanel requestCourseDetailsData", () => {
  test("sends the stored course to the panel that asked", async () => {
    const { panel, listener, shown } = await mountCourseDetails(courseDetailsContext())

    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel: shown })

    expect(postedMessages(panel)).toEqual([
      { type: "setCourseData", target: panelTarget(shown), courseData: courseWith(2) },
      { type: "reply", target: panelTarget(shown), requestId: 1, outcome: { ok: true } },
    ])
  })

  test("resends the course-details reply after the webview reloads", async () => {
    // A reload loses everything the panel was told; only what the host buffered
    // comes back, and a reply the host did not buffer is gone for good.
    const { panel, listener, shown } = await mountCourseDetails(courseDetailsContext())
    await listener({ type: "requestCourseDetailsData", requestId: 1, sourcePanel: shown })
    vi.mocked(panel.webview.postMessage).mockClear()

    await listener({ type: "ready" })

    const types = postedMessages(panel).map((m) => m.type)
    expect(types).toEqual(["setPanel", "setCourseData"])
  })
})
