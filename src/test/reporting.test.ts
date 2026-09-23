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
import { nextPanelId, TmcPanel } from "../panels/TmcPanel"
import type { ExtensionToWebview } from "../shared/shared"
import { backendName, CourseIdentifier, ExerciseIdentifier, makeMoocKind } from "../shared/shared"
import Storage from "../storage"
import type { MoocLocalCourseData } from "../storage/data"
import type UI from "../ui/ui"
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
  /** Every failure a webview was told to render, as `type: message`. */
  panelFailures: () => string[]
}

const failureTypes = new Set(["submissionStatusError", "testError", "pasteError"])

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
    confirmation: vi.fn(async () => true),
    explicitConfirmation: vi.fn(async () => true),
    // Picks the first offer of every pick: the course, the submission, "Submit to server".
    selectItem: vi.fn(async (_options: unknown, ...items: [string, unknown][]) => items[0]?.[1]),
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
    ui: { treeDP: { refresh: vi.fn() } } as unknown as UI,
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
  registerCommands(extensionContext, actionContext)
  registerCommand.mockRestore()

  const webviews: ReturnType<typeof createFakeWebviewPanel>[] = []
  vi.mocked(vscode.window.createWebviewPanel).mockImplementation(() => {
    const webview = createFakeWebviewPanel()
    webviews.push(webview)
    return webview.panel
  })
  TmcPanel.mainPanel?.dispose()
  TmcPanel.sidePanel?.dispose()
  TmcPanel.renderSide(vscode.Uri.file("/ext"), extensionContext, actionContext, {
    id: nextPanelId(),
    type: "MyCourses",
    courseDeadlines: {},
  })
  const sidePanel = webviews[0]
  if (!sidePanel) {
    throw new Error("the side panel was never created")
  }

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
    post: (message) => sidePanel.getMessageListener()(message),
    shown,
    panelFailures: () =>
      webviews
        .flatMap((webview) => vi.mocked(webview.panel.webview.postMessage).mock.calls)
        .map(([message]) => message as ExtensionToWebview)
        .filter((message) => failureTypes.has(message.type))
        .map((message) => {
          const error = (message as { error: string | { message: string } }).error
          return `${message.type}: ${typeof error === "string" ? error : error.message}`
        }),
  }
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

beforeEach(function () {
  vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
})

suite("reported once: exercise commands", function () {
  test("a failed test run shows in its panel, and nothing else", async function () {
    const { run, shown, panelFailures } = await harness({
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
    expect(panelFailures()).toEqual(["testError: compile failed"])
  })

  test("a test run that cannot start is one notification", async function () {
    const { run, shown } = await harness({ course: storedCourse({ name: "renamed" }) })

    await run("tmc.testExercise")

    expect(shown).toEqual(["error: Exercise test run failed."])
  })

  test("a failed submission shows in its panel only", async function () {
    const { run, shown, panelFailures } = await harness({
      langs: { submitMoocExerciseAndWaitForResults: async () => Err(new ConnectionError("reset")) },
    })

    await run("tmc.submitExercise")

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["submissionStatusError: reset"])
  })

  test("a failed submission with a remedy is also notified, once", async function () {
    const { run, shown, panelFailures } = await harness({
      langs: {
        submitMoocExerciseAndWaitForResults: async () =>
          Err(new InsufficientScopeError("exercise-services")),
      },
    })

    await run("tmc.submitExercise")

    expect(shown).toEqual(["error: Exercise submission failed."])
    expect(panelFailures()).toHaveLength(1)
  })

  test("a submission from the panel fails in the panel only", async function () {
    const { post, shown, panelFailures } = await harness({
      langs: { submitMoocExerciseAndWaitForResults: async () => Err(new ConnectionError("reset")) },
    })

    await post({
      type: "submitExercise",
      course: makeMoocKind(storedCourse()),
      exercise: makeMoocKind(storedCourse().exercises[0]),
      exerciseUri: exercise.uri,
    })

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["submissionStatusError: reset"])
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
    const { post, shown, panelFailures } = await harness({
      langs: { submitMoocExerciseToPaste: async () => Err(offline()) },
    })

    await post({
      type: "pasteExercise",
      requestingPanel: { id: 1, type: "ExerciseTests" },
      course: makeMoocKind(storedCourse()),
      exercise: makeMoocKind(storedCourse().exercises[0]),
    })

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual(["pasteError: offline"])
  })

  test("a panel paste that finds a submission in flight shows in the panel only", async function () {
    const submission = pending<Err<Error>>()
    const { run, post, shown, panelFailures } = await harness({
      langs: { submitMoocExerciseAndWaitForResults: () => submission.promise },
    })

    const submitting = run("tmc.submitExercise")
    await post({
      type: "pasteExercise",
      requestingPanel: { id: 1, type: "ExerciseTests" },
      course: makeMoocKind(storedCourse()),
      exercise: makeMoocKind(storedCourse().exercises[0]),
    })
    submission.resolve(Err(new ConnectionError("reset")))
    await submitting

    expect(shown).toEqual([])
    expect(panelFailures()).toEqual([
      "pasteError: A submission for this exercise is already in progress.",
      "submissionStatusError: reset",
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

    await run("tmc.addNewCourse")

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

    expect(shown).toEqual(["error: Failed to move the projects directory."])
  })

  test("a wipe that fails is one notification, and does not reload", async function () {
    const { run, shown } = await harness({ langs: { resetSettings: async () => Err(offline()) } })

    await run("tmc.wipe")

    expect(shown).toEqual(["error: Failed to wipe extension data."])
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.reloadWindow")
  })

  test("a removal that fails is one notification, and is not announced", async function () {
    const { post, shown, storage } = await harness()
    vi.spyOn(storage, "updateUserData").mockRejectedValue(new Error("disk full"))

    await post({ type: "removeCourse", id: COURSE_ID })

    expect(shown).toEqual([`error: Failed to remove "${COURSE}" from your courses.`])
  })

  test("a removal whose cleanup fails warns once, and still announces it", async function () {
    const { post, shown } = await harness({ langs: { unsetSetting: async () => Err(offline()) } })

    await post({ type: "removeCourse", id: COURSE_ID })

    expect(shown).toEqual([
      `error: Failed to remove TMC-langs data for "${COURSE}".`,
      `info: ${COURSE} was removed from courses.`,
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

suite("reported once: My Courses and course details", function () {
  test("exercises that fail to open are one notification", async function () {
    const { post, shown } = await harness({
      workspaceManager: { openCourseExercises: async () => Err(offline()) },
    })

    await post({
      type: "openExercises",
      ids: [ExerciseIdentifier.from(EXERCISE_ID)],
      courseId: COURSE_ID,
    })

    expect(shown).toEqual(["error: Failed to open the selected exercises."])
  })

  test("exercises that fail to close are one notification", async function () {
    const { post, shown } = await harness({
      workspaceManager: { closeCourseExercises: async () => Err(offline()) },
    })

    await post({
      type: "closeExercises",
      ids: [ExerciseIdentifier.from(EXERCISE_ID)],
      courseId: COURSE_ID,
    })

    expect(shown).toEqual(["error: Failed to close the selected exercises."])
  })

  const moocDownloadFails = {
    downloadExercises: async () => ({
      mooc: { downloaded: [], failed: [], skipped: [] },
      moocError: offline(),
    }),
  }

  test.each(["download", "update"])(
    "a failed %s from a panel is one warning",
    async function (mode) {
      const { post, shown } = await harness({ langs: moocDownloadFails })

      await post({
        type: "downloadExercises",
        ids: [ExerciseIdentifier.from(EXERCISE_ID)],
        courseId: COURSE_ID,
        mode,
      })

      expect(shown).toEqual([`error: Failed to download exercises from ${backendName("mooc")}.`])
    },
  )

  test("a failed new-exercise download from the palette is one warning", async function () {
    const { run, shown } = await harness({
      langs: moocDownloadFails,
      course: storedCourse({ newExercises: [EXERCISE_ID] }),
    })

    await run("tmc.downloadNewExercises")

    expect(shown).toEqual([`error: Failed to download exercises from ${backendName("mooc")}.`])
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

    expect(shown).toEqual([`error: Failed to download exercises from ${backendName("mooc")}.`])
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

  test("a course that fails to refresh from its panel is one notification", async function () {
    const { post, shown } = await harness({
      langs: {
        getMoocCourseData: async () => Err(offline()),
        listLocalExercises: async () => Err(new Error("rescan failed")),
      },
    })

    await post({ type: "refreshCourseDetails", id: COURSE_ID, useCache: false })

    expect(shown).toEqual(["error: Failed to update course."])
  })

  test("a lost session scope is warned once, however often it is hit", async function () {
    const { post, shown } = await harness({
      langs: {
        getMoocCourseData: async () => Err(new InsufficientScopeError("exercise-services")),
      },
    })

    await post({ type: "refreshCourseDetails", id: COURSE_ID, useCache: false })
    await post({ type: "refreshCourseDetails", id: COURSE_ID, useCache: false })

    expect(shown).toEqual(["error: Failed to update course data."])
  })
})

suite("reported once: the refresh", function () {
  test("a tree refresh that fails is one notification", async function () {
    const { run, shown } = await harness({
      langs: { getMoocCourseData: async () => Err(offline()) },
    })

    await run("tmcTreeView.refreshCourses")

    expect(shown).toEqual([
      "info: All exercises are up to date.",
      "error: Failed to check for course updates.",
    ])
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
      .mock.calls.find(([message]) => message.startsWith("Found 1 new exercises"))
    vi.spyOn(storage, "updateUserData").mockRejectedValue(new Error("disk full"))
    offer?.[2]?.[1]()

    await vi.waitFor(() =>
      expect(shown).toEqual([
        `info: Found 1 new exercises for ${COURSE}. Do you wish to download them now?`,
        "error: Failed to postpone the reminder.",
      ]),
    )
  })
})
