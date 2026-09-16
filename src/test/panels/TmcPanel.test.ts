import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../../api/langs"
import { ConnectionError, ForbiddenError } from "../../errors"
import { moocLoginRegistry } from "../../panels/moocLoginRegistry"
import type { WebviewHandlers } from "../../panels/TmcPanel"
import { randomPanelId, registerWebviewHandlers, TmcPanel } from "../../panels/TmcPanel"
import { postUpdateables, updateablesRegistry } from "../../panels/updateablesRegistry"
import { CourseIdentifier, ExerciseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
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
    actionContext.langs = Ok({ authenticateMooc } as unknown as Langs)

    // Render the MoocLogin panel standalone, the way `tmc.showMoocLogin` does.
    const loginPanelId = randomPanelId()
    await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
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
})

// Mounts a fresh side panel (resetting any panel state a previous test left
// behind) and returns the fake webview panel + its captured message listener,
// so a test can post a message directly and inspect what got posted back.
async function mountSidePanel(actionContext: ReturnType<typeof createMockActionContext>): Promise<{
  panel: ReturnType<typeof createFakeWebviewPanel>["panel"]
  listener: (message: unknown) => Promise<void>
}> {
  TmcPanel.sidePanel?.dispose()
  TmcPanel.sidePanel = undefined

  const { panel, getMessageListener } = createFakeWebviewPanel()
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

  const extensionContext = createMockContext()
  const extensionUri = vscode.Uri.file("/ext")

  await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
    id: randomPanelId(),
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
  test("a click that cannot be served is reported, with a route to the help panel", async () => {
    const actionContext = createMockActionContext()
    actionContext.userData = Err(new Error("no user data"))
    const { listener } = await mountSidePanel(actionContext)

    await listener({ type: "removeCourse", id: CourseIdentifier.from(1) })

    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      "The extension did not initialize properly, so this action is unavailable.",
      expect.any(Error),
      ["Show help", expect.any(Function)],
    )

    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    try {
      const [, , button] = vi.mocked(actionContext.dialog.errorNotification).mock.calls[0] as [
        string,
        Error,
        [string, () => void],
      ]
      button[1]()

      expect(executeCommand).toHaveBeenCalledWith("tmc.viewInitializationErrorHelp")
    } finally {
      executeCommand.mockRestore()
    }
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
    pasteMoocExercise: vi.fn().mockResolvedValue(Ok("link")),
    pasteTmcExercise: vi.fn().mockResolvedValue(Ok("link")),
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
    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      "Errored while closing selected exercises.",
      expect.any(Error),
    )
  })

  test("cancels a test run through the registered handler", async () => {
    const handlers = stubHandlers()
    registerWebviewHandlers(handlers as unknown as WebviewHandlers)
    const { listener } = await mountSidePanel(createMockActionContext())

    await listener({ type: "cancelTests", testRunId: 7 })

    expect(handlers.cancelTests).toHaveBeenCalledWith(7)
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
    return {
      ...createMockActionContext(),
      langs: Ok({
        getCourseDetails: vi.fn().mockResolvedValue(Err(new Error("offline"))),
      } as unknown as Langs),
      userData: Ok({
        getCourse: () => Ok(localCourse),
      }) as unknown as ReturnType<typeof createMockActionContext>["userData"],
      workspaceManager: Ok({
        getExercises: () => [],
      }) as unknown as ReturnType<typeof createMockActionContext>["workspaceManager"],
    }
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

    await listener({ type: "requestCourseDetailsData", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "setUpdateables",
      target: sourcePanel,
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

    await listener({ type: "requestCourseDetailsData", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "setUpdateables", exerciseIds: [] }),
    )
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
    const { panel, dispose } = createFakeWebviewPanel()
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel)
    createWebviewPanel.mockClear()
    createWebviewPanel.mockReturnValue(panel)

    const extensionContext = createMockContext()
    const extensionUri = vscode.Uri.file("/ext")
    const actionContext = createMockActionContext()

    await TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: randomPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
    vi.mocked(panel.webview.postMessage).mockClear()
    await TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: randomPanelId(),
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
    await TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: randomPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
    const side = createFakeWebviewPanel()
    createWebviewPanel.mockReturnValue(side.panel)
    await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
      id: randomPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })

    await TmcPanel.renderMain(extensionUri, extensionContext, actionContext, {
      id: randomPanelId(),
      type: "Welcome",
    })

    expect(side.dispose).not.toHaveBeenCalled()
    expect(TmcPanel.sidePanel).toBeDefined()
  })

  test("re-entering dispose tears the panel down only once", async () => {
    const { panel, dispose } = createFakeWebviewPanel()
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel)

    await TmcPanel.renderMain(
      vscode.Uri.file("/ext"),
      createMockContext(),
      createMockActionContext(),
      { id: randomPanelId(), type: "MyCourses", courseDeadlines: {} },
    )
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

  await TmcPanel.renderMain(
    vscode.Uri.file("/ext"),
    createMockContext(),
    createMockActionContext(),
    { id: randomPanelId(), type: "MyCourses", courseDeadlines: {} },
  )
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

function courseWith(exerciseCount: number) {
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
      deadline: null,
      passed: false,
      softDeadline: null,
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

  async function openCourseDetails(exerciseCount: number): Promise<{
    posted: { type: string }[]
  }> {
    const course = courseWith(exerciseCount)
    const actionContext = {
      ...createMockActionContext(),
      langs: Ok({
        getCourseDetails: vi.fn().mockResolvedValue(Ok({})),
      } as unknown as Langs),
      userData: Ok({ getCourse: () => Ok(course) }),
      workspaceManager: Ok({ getExercises: () => [] }),
    } as unknown as ReturnType<typeof createMockActionContext>

    const { panel, listener } = await mountSidePanel(actionContext)
    await listener({
      type: "requestCourseDetailsData",
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

  test("reports every exercise's status in one message", async () => {
    const { posted } = await openCourseDetails(EXERCISE_COUNT)

    const statuses = posted.filter((m) => m.type === "setExerciseStatuses")
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({
      courseId: COURSE_ID,
      statuses: expect.any(Array),
    })
    expect((statuses[0] as { statuses: unknown[] }).statuses).toHaveLength(EXERCISE_COUNT)
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
    return {
      ...createMockActionContext(),
      langs: Ok({ getCourseDetails } as unknown as Langs),
      userData: Ok({ getCourse: () => Ok(courseWith(2)) }),
      workspaceManager: Ok({ getExercises: () => [] }),
    } as unknown as ReturnType<typeof createMockActionContext>
  }

  test("renders the course without waiting for the backend", async () => {
    // Never resolves, standing in for a slow or hanging CLI invocation.
    const actionContext = contextProbing(vi.fn().mockReturnValue(new Promise(() => {})))
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", sourcePanel })

    const posted = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => m as { type: string })
    expect(posted.map((m) => m.type)).toEqual([
      "setCourseData",
      "setUpdateables",
      "setCourseDisabledStatus",
      "setExerciseStatuses",
      "setCourseGroups",
    ])
    expect(posted.at(-1)).toMatchObject({ offlineMode: false })
  })

  test("corrects the view with one message when the backend is unreachable", async () => {
    const actionContext = contextProbing(
      vi.fn().mockResolvedValue(Err(new ConnectionError("down"))),
    )
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", sourcePanel })
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

  test("leaves the deadlines standing when the backend answers with a failure", async () => {
    // Only an unreachable backend makes the stored deadlines untrustworthy; a reachable
    // one refusing the request says nothing about them.
    const actionContext = contextProbing(vi.fn().mockResolvedValue(Err(new ForbiddenError("no"))))
    const { panel, listener } = await mountSidePanel(actionContext)

    await listener({ type: "requestCourseDetailsData", sourcePanel })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const posted = vi
      .mocked(panel.webview.postMessage)
      .mock.calls.map(([m]) => m as { type: string })
    expect(posted.filter((m) => m.type === "setCourseGroups")).toHaveLength(1)
  })
})
