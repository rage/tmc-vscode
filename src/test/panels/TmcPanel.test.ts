import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { UserData } from "../../config/userdata"
import { moocLoginRegistry } from "../../panels/moocLoginRegistry"
import { randomPanelId, TmcPanel } from "../../panels/TmcPanel"
import { postUpdateables, updateablesRegistry } from "../../panels/updateablesRegistry"
import { CourseIdentifier, ExerciseIdentifier, makeTmcKind } from "../../shared/shared"
import Storage from "../../storage"
import type UI from "../../ui/ui"
import { MOOC_EXERCISE_UUID, MOOC_INSTANCE_UUID, moocCourseInstance } from "../fixtures/tmc"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createMockContext } from "../mocks/vscode"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

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
  const dispose = vi.fn()
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
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
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
  test(
    "a standalone login (no requestingPanel) closes the side panel and offers add-new-course, " +
      "instead of navigating to SelectMoocCourse",
    async () => {
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

      // Simulate the webview posting `moocLogin` on mount, with no `requestingPanel`.
      const listener = getMessageListener()
      await listener({
        type: "moocLogin",
        sourcePanel: { id: loginPanelId, type: "MoocLogin" },
      })

      expect(authenticateMooc).toHaveBeenCalledTimes(1)
      // No navigation to SelectMoocCourse: no second panel was ever created.
      expect(createWebviewPanel).toHaveBeenCalledTimes(1)
      // The side panel is closed instead...
      expect(dispose).toHaveBeenCalled()
      expect(TmcPanel.sidePanel).toBeUndefined()
      // ...and a confirmation toast is shown, offering the step the user most
      // likely came for without forcing it on a session-renewal login.
      expect(actionContext.dialog.notification).toHaveBeenCalledWith(
        "Logged in to courses.mooc.fi.",
        ["Add new course", expect.any(Function)],
      )
      const executeCommand = vi
        .spyOn(vscode.commands, "executeCommand")
        .mockResolvedValue(undefined)
      const [, button] = vi.mocked(actionContext.dialog.notification).mock.calls[0] as [
        string,
        [string, () => void],
      ]
      button[1]()
      expect(executeCommand).toHaveBeenCalledWith("tmc.addNewCourse")
      executeCommand.mockRestore()
    },
  )
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

suite("TmcPanel selectPlatform handling", () => {
  test("renders a SelectPlatform side panel carrying the requesting panel", async () => {
    const actionContext = createMockActionContext()
    const { panel, listener } = await mountSidePanel(actionContext)

    const sourcePanel = { id: 42, type: "MyCourses" as const }
    await listener({ type: "selectPlatform", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "SelectPlatform", requestingPanel: sourcePanel }),
      }),
    )
  })
})

suite("TmcPanel selectMoocCourse handling", () => {
  test("renders SelectMoocCourse when already authenticated", async () => {
    const actionContext = createMockActionContext()
    actionContext.langs = Ok({
      isMoocAuthenticated: vi.fn().mockResolvedValue(Ok(true)),
    } as unknown as Langs)
    const { panel, listener } = await mountSidePanel(actionContext)

    const sourcePanel = { id: 7, type: "MyCourses" as const }
    await listener({ type: "selectMoocCourse", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "SelectMoocCourse", requestingPanel: sourcePanel }),
      }),
    )
  })

  test("renders MoocLogin when not authenticated", async () => {
    const actionContext = createMockActionContext()
    actionContext.langs = Ok({
      isMoocAuthenticated: vi.fn().mockResolvedValue(Ok(false)),
    } as unknown as Langs)
    const { panel, listener } = await mountSidePanel(actionContext)

    const sourcePanel = { id: 8, type: "MyCourses" as const }
    await listener({ type: "selectMoocCourse", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setPanel",
        panel: expect.objectContaining({ type: "MoocLogin", requestingPanel: sourcePanel }),
      }),
    )
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

suite("TmcPanel requestSelectMoocCourseData handling", () => {
  test("fetches enrolled course instances and posts them to the requesting panel", async () => {
    const courseInstances = [moocCourseInstance]
    const actionContext = createMockActionContext()
    actionContext.langs = Ok({
      getEnrolledMoocCourseInstances: vi.fn().mockResolvedValue(Ok(courseInstances)),
    } as unknown as Langs)
    const { panel, listener } = await mountSidePanel(actionContext)

    const sourcePanel = {
      id: 21,
      type: "SelectMoocCourse" as const,
      requestingPanel: { id: 1, type: "MyCourses" as const },
    }
    await listener({ type: "requestSelectMoocCourseData", sourcePanel })

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setSelectMoocCourseData",
        target: sourcePanel,
        courseInstances,
      }),
    )
  })

  test("on failure, shows an error notification and posts a data error to the panel", async () => {
    const actionContext = createMockActionContext()
    actionContext.langs = Ok({
      getEnrolledMoocCourseInstances: vi.fn().mockResolvedValue(Err(new Error("network down"))),
    } as unknown as Langs)
    const { panel, listener } = await mountSidePanel(actionContext)

    const sourcePanel = {
      id: 22,
      type: "SelectMoocCourse" as const,
      requestingPanel: { id: 1, type: "MyCourses" as const },
    }
    await listener({ type: "requestSelectMoocCourseData", sourcePanel })

    expect(actionContext.dialog.errorNotification).toHaveBeenCalledTimes(1)
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "requestSelectMoocCourseDataError",
        target: sourcePanel,
      }),
    )
  })
})

suite("TmcPanel addMoocCourse handling", () => {
  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let userData: UserData
  let workspaceManagerMock: WorkspaceManager
  let addChildWithId: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[workspaceManagerMock] = createWorkspaceMangerMock()
    workspaceManagerMock.createWorkspaceFile = vi.fn() as never
    addChildWithId = vi.fn()
    const storage = new Storage(createMockContext())
    await storage.updateUserData({ courses: [], mooc_courses: [] })
    userData = new UserData(storage)
  })

  function contextFor(): ReturnType<typeof createMockActionContext> {
    return {
      ...createMockActionContext(),
      langs: Ok(tmcMock),
      userData: Ok(userData),
      workspaceManager: Ok(workspaceManagerMock),
      ui: { treeDP: { addChildWithId } } as unknown as UI,
    }
  }

  test("adds the mooc course and confirms via setMyCourses to the requesting panel", async () => {
    const actionContext = contextFor()
    const { panel, listener } = await mountSidePanel(actionContext)

    const requestingPanel = { id: 3, type: "MyCourses" as const }
    await listener({
      type: "addMoocCourse",
      instanceId: MOOC_INSTANCE_UUID,
      courseName: moocCourseInstance.name,
      requestingPanel,
    })

    expect(userData.getMoocCourses()[0]?.id).toBe(moocCourseInstance.id)
    expect(userData.getMoocCourses()[0]?.exercises.map((e) => e.id)).toEqual([MOOC_EXERCISE_UUID])
    expect(addChildWithId).toHaveBeenCalledTimes(1)
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setMyCourses",
        target: requestingPanel,
        courses: userData.getCourses(),
      }),
    )
  })

  test("on failure, shows an error notification and does not add a course", async () => {
    tmcMockValues.getMoocCourseInstanceData = Err(new Error("boom"))
    const actionContext = contextFor()
    const { listener } = await mountSidePanel(actionContext)

    const requestingPanel = { id: 4, type: "MyCourses" as const }
    await listener({
      type: "addMoocCourse",
      instanceId: MOOC_INSTANCE_UUID,
      courseName: moocCourseInstance.name,
      requestingPanel,
    })

    expect(actionContext.dialog.errorNotification).toHaveBeenCalledWith(
      "Failed to add new course.",
      expect.any(Error),
    )
    expect(userData.getMoocCourses()).toEqual([])
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
        getCourse: () => localCourse,
      }) as unknown as ReturnType<typeof createMockActionContext>["userData"],
      workspaceManager: Ok({
        getExerciseBySlug: () => undefined,
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
