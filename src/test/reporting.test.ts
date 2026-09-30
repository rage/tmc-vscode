import * as os from "os"

import * as fs from "fs-extra"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext, ReadyStartup } from "../actions/types"
import type Dialog from "../api/dialog"
import type Langs from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import type WorkspaceManager from "../api/workspaceManager"
import { ExerciseStatus } from "../api/workspaceManager"
import * as commands from "../commands"
import type Resources from "../config/resources"
import { UserData } from "../config/userdata"
import { BottleneckError, ConnectionError, InsufficientScopeError } from "../errors"
import { registerCommands } from "../init/commands"
import { registerTesting } from "../init/testing"
import { nextPanelId } from "../panels/routes"
import { TmcPanel } from "../panels/TmcPanel"
import type { ExerciseStatus as RowStatus, ExtensionToWebview } from "../shared/shared"
import { backendName, CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import Storage from "../storage"
import type { MoocLocalCourseData } from "../storage/data"
import { CourseTreeItem, ExerciseTreeItem } from "../ui/treeview/treeview"
import type CoursesTree from "../ui/treeview/treeview"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { createMockActionContext } from "./mocks/actionContext"
import { createMockContext } from "./mocks/vscode"
import { autoMock } from "./support/mock"
import { createFakeWebviewPanel } from "./support/webviewPanel"

// Each layer's own tests mock the layer next to it, so a failure both layers report (or
// neither does) passes both. These drive the registered command or the webview message
// over the real operations, with only the services faked, and read what the user was shown.

const COURSE = "mooc-course"
const EXERCISE = "loops"
const EXERCISE_ID = "mooc-ex-1"
const COURSE_ID = CourseIdentifier.from("instance-1")

/** The stored exercise's row in the Courses view, as its commands receive it. */
function exerciseRow(status: RowStatus): ExerciseTreeItem {
  return Object.assign(Object.create(ExerciseTreeItem.prototype) as ExerciseTreeItem, {
    id: EXERCISE_ID,
    courseId: COURSE_ID,
    exerciseId: ExerciseIdentifier.from(EXERCISE_ID),
    status,
  })
}

function courseRow(): CourseTreeItem {
  return Object.assign(Object.create(CourseTreeItem.prototype) as CourseTreeItem, {
    courseId: COURSE_ID,
  })
}

function storedCourse(overrides: Partial<MoocLocalCourseData> = {}): MoocLocalCourseData {
  return {
    id: "instance-1",
    name: COURSE,
    title: "Mooc Course",
    description: null,
    organization: "mooc",
    exercises: [
      {
        id: EXERCISE_ID,
        name: EXERCISE,
        availablePoints: 1,
        awardedPoints: 0,
        deadline: null,
        passed: false,
        softDeadline: null,
      },
    ],
    availablePoints: 1,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  }
}

const exercise: WorkspaceExercise = {
  backend: "mooc",
  courseSlug: COURSE,
  exerciseSlug: EXERCISE,
  status: ExerciseStatus.Open,
  uri: vscode.Uri.file("/projects/mooc-course/loops"),
}

/** Services with the defaults a flow reaches on its way to the failure under test. */
function fakeService<T>(overrides: Record<string, unknown>, defaults: Record<string, unknown>): T {
  const fallback = autoMock<Record<string, unknown>>()
  const methods = { ...defaults, ...overrides }
  return new Proxy(
    {},
    { get: (_target, prop: string) => (prop in methods ? methods[prop] : fallback[prop]) },
  ) as T
}

interface Harness {
  actionContext: ReadyActionContext
  storage: Storage
  /** Runs a registered command, as the palette would. */
  run: (id: string, ...args: unknown[]) => Promise<unknown>
  /** Posts a message from the webview to the side panel. */
  post: (message: unknown) => Promise<void>
  /** Every notification shown, as `kind: sentence`, in order. */
  shown: string[]
  /** Every failure a webview was told to render, as `type: message`; a reply by its request's type. */
  panelFailures: () => string[]
  /** The id and type of the panel the side webview shows. */
  shownPanel: () => { id: number; type: string }
}

async function harness(
  services: {
    langs?: Record<string, unknown>
    workspaceManager?: Record<string, unknown>
    resources?: Partial<Resources>
    course?: MoocLocalCourseData
  } = {},
): Promise<Harness> {
  const shown: string[] = []
  const toast = (kind: string) =>
    vi.fn(async (message: string) => {
      shown.push(`${kind}: ${message}`)
    })
  const dialog = {
    reportError: toast("error"),
    errorNotification: toast("error"),
    warningNotification: toast("warning"),
    notification: toast("info"),
    statusMessage: vi.fn((message: string) => {
      shown.push(`status: ${message}`)
    }),
    confirm: vi.fn(async () => true),
    explicitConfirmation: vi.fn(async () => true),
    // Takes the first offer of every prompt: the course, the submission, "Submit and …".
    choose: vi.fn(
      async (_message: string, _options: unknown, ...choices: [string, unknown][]) =>
        choices[0]?.[1],
    ),
    selectItem: vi.fn(async (_options: unknown, ...items: { value: unknown }[]) => items[0]?.value),
    progressNotification: vi.fn(
      (_message: string, task: (progress: unknown, token: unknown) => unknown) =>
        task(
          { report: () => {} },
          { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
        ),
    ),
  } as unknown as Dialog

  const storage = new Storage(createMockContext())
  await storage.updateUserData({ courses: [], mooc_courses: [services.course ?? storedCourse()] })

  const langs = fakeService<Langs>(services.langs ?? {}, {
    listLocalExercises: async () => Ok([]),
    listSettings: async () => Ok({}),
    checkExerciseUpdates: async () => Ok([]),
    unsetSetting: async () => Ok.EMPTY,
    listLocalCourseExercises: async () => Ok([{ "exercise-id": EXERCISE_ID }]),
  })
  const workspaceManager = fakeService<WorkspaceManager>(services.workspaceManager ?? {}, {
    activeExercise: exercise,
    activeCourse: undefined,
    getExerciseContaining: () => exercise,
    getExerciseBySlug: () => exercise,
    getExercisesByCourseSlug: () => [exercise],
    getExercises: () => [exercise],
    setExercises: async () => Ok.EMPTY,
    deleteWorkspaceFile: async () => Ok.EMPTY,
    createWorkspaceFile: async () => {},
  })

  const actionContext: ReadyActionContext = {
    ...createMockActionContext({
      startup: {
        langs,
        userData: new UserData(storage),
        workspaceManager,
        resources: {
          projectsDirectory: "/projects",
          getWorkspaceFilePath: () => "/workspaces/mooc-course.code-workspace",
          ...services.resources,
        } as Resources,
      } as Partial<ReadyStartup>,
    }),
    dialog,
    coursesTree: { setBackendReachable: vi.fn() } as unknown as CoursesTree,
  }

  const commandHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const registerCommand = vi
    .spyOn(vscode.commands, "registerCommand")
    .mockImplementation((id: string, handler: (...args: unknown[]) => unknown) => {
      commandHandlers.set(id, handler as (...args: unknown[]) => Promise<unknown>)
      return { dispose: vi.fn() }
    })
  const subscriptions: vscode.Disposable[] = []
  const extensionContext = new Proxy(createMockContext(), {
    get: (target, prop) => (prop === "subscriptions" ? subscriptions : Reflect.get(target, prop)),
  })
  registerCommands(
    extensionContext,
    actionContext,
    registerTesting(extensionContext, actionContext),
  )
  registerCommand.mockRestore()
  // The panel runs a command through VS Code, which dispatches to the registered handler.
  vi.mocked(vscode.commands.executeCommand).mockImplementation(async (id, ...args) =>
    commandHandlers.get(id)?.(...args),
  )
  const submissionViewing = TmcPanel.showSubmissionViews(extensionContext, actionContext)
  onTestFinished(() => submissionViewing.dispose())

  const webviews: ReturnType<typeof createFakeWebviewPanel>[] = []
  const requestTypes = new Map<number, string>()
  vi.mocked(vscode.window.createWebviewPanel).mockImplementation(() => {
    const webview = createFakeWebviewPanel()
    webviews.push(webview)
    return webview.panel
  })
  TmcPanel.mainPanel?.dispose()
  TmcPanel.sidePanel?.dispose()
  TmcPanel.renderSide(extensionContext, actionContext, {
    id: nextPanelId(),
    type: "CourseDetails",
    courseId: COURSE_ID,
  })
  const sidePanel = webviews[0]
  if (!sidePanel) {
    throw new Error("the side panel was never created")
  }
  await sidePanel.sendReady()

  return {
    actionContext,
    storage,
    run: async (id, ...args) => {
      const handler = commandHandlers.get(id)
      if (!handler) {
        throw new Error(`${id} is not registered`)
      }
      return handler(...args)
    },
    post: (message) => {
      const request = message as { type: string; requestId?: number }
      if (request.requestId !== undefined) {
        requestTypes.set(request.requestId, request.type)
      }
      return sidePanel.getMessageListener()(message)
    },
    shown,
    panelFailures: () =>
      webviews
        .flatMap((webview) => vi.mocked(webview.panel.webview.postMessage).mock.calls)
        .map(([message]) => message as ExtensionToWebview)
        .flatMap((message) => {
          if (message.type === "reply") {
            return message.outcome.ok
              ? []
              : [`${requestTypes.get(message.requestId)}: ${message.outcome.error.message}`]
          }
          return message.type === "submissionView" && message.view.error
            ? [`${message.type}: ${message.view.error.message}`]
            : []
        }),
    shownPanel: () => {
      const { id, type } = (
        TmcPanel.sidePanel as unknown as { _route: { id: number; type: string } }
      )._route
      return { id, type }
    },
  }
}

/** Shows the stored exercise's submission panel on the side, as submitting does. */
function showSubmission(actionContext: ReadyActionContext): void {
  const [storedExercise] = storedCourse().exercises
  if (!storedExercise) {
    throw new Error("the stored course has no exercise")
  }
  TmcPanel.renderSide(createMockContext(), actionContext, {
    id: nextPanelId(),
    type: "ExerciseSubmission",
    backend: "mooc",
    courseSlug: storedCourse().name,
    exerciseSlug: storedExercise.name,
  })
}

const offline = (): Error => new Error("offline")
const throttled = async (): Promise<Err<Error>> =>
  Err(new BottleneckError("This command can't be executed at the moment."))
const oldSubmission = [{ id: "sub-1", created_at: "2026-01-01T00:00:00Z", grading_progress: null }]
const oldSubmissions = async (): Promise<Ok<typeof oldSubmission>> => Ok(oldSubmission)
const pending = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** The messages the latest local test run errored its items with. */
function lastTestRunErrors(): string[] {
  const controller = vi.mocked(vscode.tests.createTestController).mock.results.at(-1)?.value as {
    runs: { results: [string, string, vscode.TestMessage?][] }[]
  }
  return (controller.runs.at(-1)?.results ?? [])
    .filter(([state]) => state === "errored")
    .map(([, , message]) => String(message?.message))
}

beforeEach(function () {
  vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
  updateablesRegistry.clear()
})

// jest-mock-vscode ships no `env` namespace; the old-submission picker formats dates with it.
beforeAll(function () {
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", { value: { language: "en" }, configurable: true })
})

suite("reported once: exercise commands", function () {
  test("a failed test run shows in Test Results, and nothing else", async function () {
    const { run, shown } = await harness({
      langs: {
        runTests: () => ({
          process: Promise.resolve(Err(new Error("compile failed"))),
          interrupt() {},
        }),
        runCheckstyle: () => ({ process: Promise.resolve(Ok(null)), interrupt() {} }),
      },
    })

    await run("tmc.testExercise")

    expect(shown).toEqual([])
    expect(lastTestRunErrors()).toEqual(["The tests could not be run: compile failed"])
  })

  test("a test run that cannot start shows in Test Results, and nothing else", async function () {
    const { run, shown } = await harness({ course: storedCourse({ name: "renamed" }) })

    await run("tmc.testExercise")

    expect(shown).toEqual([])
    expect(lastTestRunErrors()).toEqual([
      "The tests could not be run: No mooc course with slug mooc-course",
    ])
  })

  test("a failed submission shows in its panel only", async function () {
    const { run, shown, panelFailures } = await harness({
      langs: { submitMoocExercise: async () => Err(new ConnectionError("reset")) },
    })

    await run("tmc.submitExercise")

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["submissionView: Reset."])
  })

  test("a failed submission with a remedy shows in its panel only, remedy included", async function () {
    const { run, shown, panelFailures } = await harness({
      langs: {
        submitMoocExercise: async () => Err(new InsufficientScopeError("exercise-services")),
      },
    })

    await run("tmc.submitExercise")

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual([
      expect.stringMatching(/^submissionView: .*Log in again to continue\.$/),
    ])
  })

  test("a failed paste from the palette is one notification", async function () {
    const { run, shown } = await harness({
      langs: { submitMoocExerciseToPaste: async () => Err(offline()) },
    })

    await run("tmc.pasteExercise")

    expect(shown).toEqual([`error: Failed to send the exercise to ${backendName("mooc")} paste.`])
  })

  test.each([
    ["tmc.pasteExercise", "submitMoocExerciseToPaste"],
    ["tmc.resetExercise", "resetExercise"],
    ["tmc.downloadOldSubmission", "downloadMoocOldSubmission"],
  ])("a throttled %s says so, as information", async function (id, method) {
    const { run, shown } = await harness({
      langs: { getMoocOldSubmissions: oldSubmissions, [method]: throttled },
    })

    await run(id)

    expect(shown).toEqual(["info: This command can't be executed at the moment."])
  })

  test("a failed paste from the panel shows in the panel only", async function () {
    const { actionContext, post, shown, panelFailures, shownPanel } = await harness({
      langs: { submitMoocExerciseToPaste: async () => Err(offline()) },
    })
    showSubmission(actionContext)

    await post({ type: "pasteExercise", requestId: 1, sourcePanel: shownPanel() })

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["pasteExercise: Offline."])
  })

  test("a panel paste that finds a submission in flight shows in the panel only", async function () {
    const submission = pending<Err<Error>>()
    const { actionContext, run, post, shown, panelFailures, shownPanel } = await harness({
      langs: { submitMoocExercise: () => submission.promise },
    })
    showSubmission(actionContext)

    const submitting = run("tmc.submitExercise")
    await post({ type: "pasteExercise", requestId: 1, sourcePanel: shownPanel() })
    submission.resolve(Err(new ConnectionError("reset")))
    await submitting

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual([
      "pasteExercise: A submission for this exercise is already in progress.",
      "submissionView: Reset.",
    ])
  })

  test.each([
    ["tmc.cleanExercise", { clean: offline }, "Failed to clean exercise."],
    ["tmc.resetExercise", { resetExercise: offline }, "Failed to reset exercise."],
    [
      "tmc.downloadOldSubmission",
      { getMoocOldSubmissions: offline },
      "Failed to fetch old submissions.",
    ],
    [
      "tmc.downloadOldSubmission",
      {
        getMoocOldSubmissions: () => Ok(oldSubmission),
        downloadMoocOldSubmission: offline,
      },
      "Failed to download old submission.",
    ],
  ])("a failed %s is one notification", async function (id, failing, headline) {
    const langs = Object.fromEntries(
      Object.entries(failing).map(([method, outcome]) => [
        method,
        async () => {
          const result = outcome()
          return result instanceof Error ? Err(result) : result
        },
      ]),
    )
    const { run, shown } = await harness({ langs })

    await run(id)

    expect(shown).toEqual([`error: ${headline}`])
  })

  test("closing an exercise that fails is one notification", async function () {
    const { run, shown } = await harness({
      workspaceManager: { closeCourseExercises: async () => Err(offline()) },
    })

    await run("tmc.closeExercise")

    expect(shown).toEqual(["error: Error when closing exercise."])
  })
})

suite("reported once: course administration", function () {
  test("a logout with both backends failing names each, once", async function () {
    const { run, shown } = await harness({
      langs: {
        deauthenticate: async () => Err(offline()),
        deauthenticateMooc: async () => Err(offline()),
      },
    })

    await run("tmc.logout")

    expect(shown).toEqual([
      `error: Failed to log out of ${backendName("mooc")}.`,
      `error: Failed to log out of ${backendName("tmc")}.`,
    ])
  })

  test("a logout with one backend failing is one notification", async function () {
    const { run, shown } = await harness({
      langs: {
        deauthenticate: async () => Ok.EMPTY,
        deauthenticateMooc: async () => Err(offline()),
      },
    })

    await run("tmc.logout")

    expect(shown).toEqual([`error: Failed to log out of ${backendName("mooc")}.`])
  })

  test("a course that fails to add is one notification", async function () {
    const { run, shown } = await harness({
      langs: {
        getTmcOrganizations: async () => Err(offline()),
        getEnrolledMoocCourses: async () =>
          Ok([{ id: "instance-2", name: "other", organization_name: "mooc" }]),
        getMoocCourseData: async () => Err(offline()),
      },
    })

    // A quick pick that accepts the first course row as soon as one is listed.
    const accept = new vscode.EventEmitter<void>()
    const quickPick = {
      items: [] as { choice?: unknown }[],
      selectedItems: [] as unknown[],
      buttons: [],
      onDidAccept: accept.event,
      onDidHide: () => ({ dispose() {} }),
      onDidTriggerButton: () => ({ dispose() {} }),
      show() {},
      hide() {},
      dispose() {},
    }
    vi.spyOn(vscode.window, "createQuickPick").mockReturnValue(quickPick as never)
    const running = run("tmc.addNewCourse")
    await vi.waitFor(() => expect(quickPick.items.some((x) => x.choice)).toBe(true))
    quickPick.selectedItems = [quickPick.items.find((x) => x.choice)]
    accept.fire()
    await running

    expect(shown).toEqual(["error: Failed to add course."])
  })

  test("a data path that fails to move is one notification", async function () {
    const target = fs.mkdtempSync(`${os.tmpdir()}/tmc-reporting-`)
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file(target)])
    const { run, shown } = await harness({
      langs: { moveProjectsDirectory: async () => Err(offline()) },
    })

    await run("tmc.changeTmcDataPath")
    fs.removeSync(target)

    expect(shown).toEqual(["error: Failed to move the exercises folder."])
  })

  test("a wipe that fails is one notification, and does not reload", async function () {
    const { run, shown } = await harness({ langs: { resetSettings: async () => Err(offline()) } })

    await run("tmc.wipe")

    expect(shown).toEqual(["error: Failed to wipe extension data."])
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.reloadWindow")
  })

  test("a removal that fails is one notification, and is not announced", async function () {
    const { run, shown, storage } = await harness()
    vi.spyOn(storage, "updateUserData").mockRejectedValue(new Error("disk full"))

    await run("tmc.removeCourse", COURSE_ID)

    expect(shown).toEqual([`error: Failed to remove "${COURSE}" from your courses.`])
  })

  test("a removal whose cleanup fails warns once, and still announces it", async function () {
    const { run, shown } = await harness({ langs: { unsetSetting: async () => Err(offline()) } })

    await run("tmc.removeCourse", COURSE_ID)

    expect(shown).toEqual([
      `error: Failed to clear the record of closed exercises for "${COURSE}".`,
      "status: Removed Mooc Course.",
    ])
  })

  test("a course workspace that fails to open is one notification", async function () {
    const { post, shown } = await harness({
      workspaceManager: {
        createWorkspaceFile: async () => {
          throw offline()
        },
      },
    })

    await post({ type: "openCourseWorkspace", courseId: COURSE_ID })

    expect(shown).toEqual(["error: Failed to open the course workspace."])
  })
})

suite("reported once: the Courses view and course details", function () {
  test("exercises that fail to open are one notification", async function () {
    const { run, shown } = await harness({
      workspaceManager: { openCourseExercises: async () => Err(offline()) },
    })

    await run("tmc.openExercises", exerciseRow("closed"))

    expect(shown).toEqual(["error: Failed to open the exercises."])
  })

  test("exercises that fail to close are one notification", async function () {
    const { run, shown } = await harness({
      workspaceManager: { closeCourseExercises: async () => Err(offline()) },
    })

    await run("tmc.closeExercises", exerciseRow("opened"))

    expect(shown).toEqual(["error: Failed to close the exercises."])
  })

  const moocDownloadFails = {
    downloadExercises: async () => ({
      mooc: { downloaded: [], failed: [], skipped: [] },
      moocError: offline(),
    }),
  }

  test("a failed download from the Courses view is one warning", async function () {
    const { run, shown } = await harness({ langs: moocDownloadFails })

    await run("tmc.downloadExercises", exerciseRow("missing"))

    expect(shown).toEqual(["error: Failed to download the exercise loops."])
  })

  test("a failed update from the Courses view is one warning", async function () {
    const { run, shown } = await harness({ langs: moocDownloadFails })
    updateablesRegistry.set(COURSE_ID, [ExerciseIdentifier.from(EXERCISE_ID)])

    await run("tmc.updateCourseExercises", courseRow())

    expect(shown).toEqual(["error: Failed to download the exercise loops."])
  })

  test("a failed new-exercise download from the palette is one warning", async function () {
    const { run, shown } = await harness({
      langs: moocDownloadFails,
      course: storedCourse({ newExercises: [EXERCISE_ID] }),
    })

    await run("tmc.downloadNewExercises")

    expect(shown).toEqual(["error: Failed to download the exercise loops."])
  })

  test("a failed update download from the palette is one warning", async function () {
    const { actionContext, run, shown } = await harness({
      langs: {
        ...moocDownloadFails,
        checkExerciseUpdates: async () => Ok([ExerciseIdentifier.from(EXERCISE_ID)]),
      },
    })
    vi.mocked(actionContext.settings.getAutomaticallyUpdateExercises).mockReturnValue(true)

    await run("tmc.updateExercises", "loud")

    expect(shown).toEqual(["error: Failed to download the exercise loops."])
  })

  test("an update check that throws is one notification, or none when silent", async function () {
    const throwing = {
      checkExerciseUpdates: async () => {
        throw offline()
      },
    }
    const loud = await harness({ langs: throwing })
    const silent = await harness({ langs: throwing })

    await loud.run("tmc.updateExercises", "loud")
    await silent.run("tmc.updateExercises", "silent")

    expect(loud.shown).toEqual(["error: Failed to check for exercise updates."])
    expect(silent.shown).toEqual([])
  })

  test("an update check a backend with courses fails is one notification, and no all-clear", async function () {
    const moocFails = {
      checkExerciseUpdates: async (backend: string) =>
        backend === "mooc" ? Err(offline()) : Ok([]),
    }
    const loud = await harness({ langs: moocFails })
    const silent = await harness({ langs: moocFails })

    await loud.run("tmc.updateExercises", "loud")
    await silent.run("tmc.updateExercises", "silent")

    expect(loud.shown).toEqual(["error: Failed to check courses.mooc.fi for exercise updates."])
    expect(silent.shown).toEqual([])
  })

  test("an update check that fails where the user has no courses is still an all-clear", async function () {
    const { run, shown } = await harness({
      langs: {
        checkExerciseUpdates: async (backend: string) =>
          backend === "tmc" ? Err(offline()) : Ok([]),
      },
    })

    await run("tmc.updateExercises", "loud")

    expect(shown).toEqual(["status: All exercises are up to date."])
  })

  test("a course that fails to refresh from its panel shows in the panel only", async function () {
    const { post, shown, panelFailures, shownPanel } = await harness({
      langs: {
        getMoocCourseData: async () => Err(offline()),
        listLocalExercises: async () => Err(new Error("rescan failed")),
      },
    })

    await post({
      type: "refreshCourseDetails",
      requestId: 1,
      sourcePanel: shownPanel(),
    })

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["refreshCourseDetails: Offline."])
  })

  test("a lost session scope is warned once, however often it is hit", async function () {
    const { post, shown, shownPanel } = await harness({
      langs: {
        getMoocCourseData: async () => Err(new InsufficientScopeError("exercise-services")),
      },
    })
    const sourcePanel = shownPanel()

    await post({ type: "refreshCourseDetails", requestId: 1, sourcePanel })
    await post({ type: "refreshCourseDetails", requestId: 2, sourcePanel })

    expect(shown).toEqual(["error: Failed to update course data."])
  })
})

suite("reported once: the refresh", function () {
  test("a tree refresh that fails is one notification", async function () {
    const { run, shown } = await harness({
      langs: { getMoocCourseData: async () => Err(offline()) },
    })

    await run("tmcTreeView.refreshCourses")

    expect(shown).toEqual(["error: Failed to check for course updates."])
  })

  test("a lost session scope is warned on a tree refresh too", async function () {
    const { run, shown } = await harness({
      langs: {
        getMoocCourseData: async () => Err(new InsufficientScopeError("exercise-services")),
      },
    })

    await run("tmcTreeView.refreshCourses")

    expect(shown).toContain("error: Failed to update course data.")
  })

  test("a background refresh that fails shows nothing", async function () {
    const { actionContext, shown } = await harness({
      langs: { getMoocCourseData: async () => Err(offline()) },
    })

    await commands.refreshEverything(actionContext, { silent: true })

    expect(shown).toEqual([])
  })

  test("a reminder that cannot be postponed is one notification", async function () {
    const { actionContext, shown, storage } = await harness({
      langs: { getMoocCourseData: async () => Err(new ConnectionError("offline")) },
      course: storedCourse({ newExercises: [EXERCISE_ID] }),
    })

    await commands.refreshEverything(actionContext, { silent: true })
    const offer = vi
      .mocked(actionContext.dialog.notification)
      .mock.calls.find(([message]) => message.includes("new exercise"))
    vi.spyOn(storage, "updateUserData").mockRejectedValue(new Error("disk full"))
    offer?.[2]?.[1]()

    await vi.waitFor(() =>
      expect(shown).toEqual([
        "info: Mooc Course has 1 new exercise. Download it now?",
        "error: Failed to postpone the reminder for Mooc Course.",
      ]),
    )
  })
})
