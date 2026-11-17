import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { CourseHomeView, ExerciseIdentifier, Panel } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { courseDetailsHandlers } from "../../panels/handlers/courseDetails"
import type { PanelHost } from "../../panels/router"
import { buildCourseHomeView } from "../../ui/courseHome"
import { recentPolicyChanges } from "../../ui/recentPolicyChanges"
import { recentUpdates } from "../../ui/recentUpdates"
import { openCourseExercises } from "../../ui/treeview/treeCommands"
import { tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions", () => ({
  downloadCourseExercises: vi.fn(async () => Ok({ warnings: [] })),
  downloadExerciseUpdates: vi.fn(async () => Ok({ updated: [], warnings: [] })),
}))
vi.mock("../../ui/courseHome", () => ({ buildCourseHomeView: vi.fn() }))
vi.mock("../../ui/treeview/treeCommands", () => ({
  closeCompletedExercises: vi.fn(async () => {}),
  openCourseExercises: vi.fn(async () => {}),
}))
vi.mock("../../ui/exerciseSourceFile", () => ({ showExerciseSourceFile: vi.fn(async () => {}) }))

const COURSE = idOfTmcCourse(42)
const SHOWN: Extract<Panel, { type: "CourseDetails" }> = {
  id: 7,
  type: "CourseDetails",
  courseId: COURSE,
}
const SOURCE = { id: SHOWN.id, type: SHOWN.type }
const ON_DISK = { id: idOfTmcExercise(1), uri: vscode.Uri.file("/exercises/hello") }

function host(route: Panel | undefined = SHOWN): PanelHost {
  return {
    name: "Main webview",
    route,
    isVisible: true,
    post: vi.fn(),
    closeSidePanel: vi.fn(),
    showBeside: vi.fn(),
  }
}

/** Course 42 with exercise 1 on disk; exercise 9 belongs to course 43. */
function context(): ReadyActionContext {
  return createMockActionContext({
    startup: {
      userData: {
        getExercise: (id: ExerciseIdentifier) =>
          id.kind === "tmc" && id.data.tmcExerciseId === 9
            ? Ok({ course: tmcLocalCourse({ id: 43 }), exercise: tmcCourseExercise({ id: 9 }) })
            : Ok({ course: tmcLocalCourse({ id: 42 }), exercise: tmcCourseExercise({ id: 1 }) }),
        clearFromNewExercises: vi.fn(async () => Ok.EMPTY),
      } as unknown as UserData,
      workspaceManager: {
        getExercise: (id: ExerciseIdentifier) =>
          id.kind === "tmc" && id.data.tmcExerciseId === 1 ? ON_DISK : undefined,
      } as unknown as WorkspaceManager,
    },
  })
}

async function exerciseAction(
  actionContext: ReadyActionContext,
  exerciseId: ExerciseIdentifier,
  action: "open" | "download" | "reset" | "downloadOldSubmission",
  shown: Panel | undefined = SHOWN,
): Promise<PanelHost> {
  const shownHost = host(shown)
  await courseDetailsHandlers.courseExerciseAction.handle(
    { type: "courseExerciseAction", sourcePanel: SOURCE, exerciseId, action },
    { host: shownHost, actionContext },
  )
  return shownHost
}

async function courseAction(
  actionContext: ReadyActionContext,
  action: Parameters<typeof courseDetailsHandlers.courseAction.handle>[0]["action"],
): Promise<void> {
  await courseDetailsHandlers.courseAction.handle(
    { type: "courseAction", sourcePanel: SOURCE, action },
    { host: host(), actionContext },
  )
}

function viewWith(fields: Partial<CourseHomeView>): CourseHomeView {
  return { newExercises: [], updates: [], parts: [], ...fields } as CourseHomeView
}

suite("the course home's exercise actions", function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  test("open downloads if needed and opens, with progress in the Courses view", async function () {
    const actionContext = context()

    await exerciseAction(actionContext, idOfTmcExercise(1), "open")

    expect(openCourseExercises).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      COURSE,
      [idOfTmcExercise(1)],
      "coursesView",
      expect.objectContaining({ isVisible: expect.any(Function) }),
    )
  })

  test("download downloads the one exercise, with progress in the Courses view", async function () {
    const actionContext = context()

    await exerciseAction(actionContext, idOfTmcExercise(2), "download")

    expect(actions.downloadCourseExercises).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      COURSE,
      [idOfTmcExercise(2)],
      "coursesView",
    )
  })

  test("reset and old submissions run their commands, which confirm first", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const actionContext = context()

    await exerciseAction(actionContext, idOfTmcExercise(1), "reset")
    await exerciseAction(actionContext, idOfTmcExercise(1), "downloadOldSubmission")

    expect(executeCommand.mock.calls).toEqual([
      ["tmc.resetExercise", ON_DISK.uri],
      ["tmc.downloadOldSubmission", ON_DISK.uri],
    ])
  })

  test("acts on no exercise of another course, nor for a panel no longer shown", async function () {
    const actionContext = context()

    await exerciseAction(actionContext, idOfTmcExercise(9), "open")
    await exerciseAction(actionContext, idOfTmcExercise(1), "open", { ...SHOWN, id: 8 })

    expect(openCourseExercises).not.toHaveBeenCalled()
  })

  test("says so in the screen when a reset targets an exercise no longer on disk", async function () {
    const actionContext = context()

    const shownHost = await exerciseAction(actionContext, idOfTmcExercise(2), "reset")

    expect(shownHost.post).toHaveBeenCalledExactlyOnceWith({
      type: "operationFailed",
      target: SOURCE,
      failure: {
        serial: expect.any(Number),
        tone: "error",
        error: { message: "This exercise is not downloaded." },
      },
    })
    expect(actionContext.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("a download that fails says so in the screen, not in a notification", async function () {
    const actionContext = context()
    vi.mocked(actions.downloadCourseExercises).mockResolvedValueOnce(
      Err(new Error("the CLI exited with 1")),
    )

    const shownHost = await exerciseAction(actionContext, idOfTmcExercise(2), "download")

    expect(shownHost.post).toHaveBeenCalledExactlyOnceWith({
      type: "operationFailed",
      target: SOURCE,
      failure: {
        serial: expect.any(Number),
        tone: "error",
        title: "Failed to download the exercise.",
        error: { message: "The CLI exited with 1.", detailsId: expect.any(String) },
      },
    })
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
  })
})

suite("the course home's course actions", function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  test("download all downloads what can still be submitted, with progress in the Courses view", async function () {
    const actionContext = context()
    vi.mocked(buildCourseHomeView).mockReturnValue(
      Ok(
        viewWith({
          parts: [
            {
              key: "p",
              name: "Part 1",
              isDefaultOpen: true,
              exercises: [
                { id: idOfTmcExercise(1), status: "opened" },
                { id: idOfTmcExercise(2), status: "missing" },
                { id: idOfTmcExercise(3), status: "new" },
                { id: idOfTmcExercise(4), status: "expired" },
              ] as CourseHomeView["parts"][number]["exercises"],
            },
          ],
        }),
      ),
    )

    await courseAction(actionContext, "downloadAllExercises")

    expect(actions.downloadCourseExercises).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      COURSE,
      [idOfTmcExercise(2), idOfTmcExercise(3)],
      "coursesView",
    )
  })

  test("downloads the new exercises the page lists, and dismisses them", async function () {
    const actionContext = context()
    vi.mocked(buildCourseHomeView).mockReturnValue(
      Ok(viewWith({ newExercises: [{ id: idOfTmcExercise(3), name: "lists" }] })),
    )

    await courseAction(actionContext, "downloadNewExercises")
    await courseAction(actionContext, "dismissNewExercises")

    expect(actions.downloadCourseExercises).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      COURSE,
      [idOfTmcExercise(3)],
      "coursesView",
    )
    expect(actionContext.startup.userData.clearFromNewExercises).toHaveBeenCalledWith(COURSE)
  })

  test("updates the exercises the page lists as updateable", async function () {
    const actionContext = context()
    vi.mocked(buildCourseHomeView).mockReturnValue(
      Ok(viewWith({ updates: [{ id: idOfTmcExercise(1), name: "hello" }] })),
    )

    await courseAction(actionContext, "updateExercises")

    expect(actions.downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(
      actionContext,
      [{ courseId: COURSE, exerciseId: idOfTmcExercise(1) }],
      false,
      "coursesView",
    )
  })

  test("leaves the updates that failed to the page's notice, showing any other warning", async function () {
    const actionContext = context()
    vi.mocked(buildCourseHomeView).mockReturnValue(
      Ok(viewWith({ updates: [{ id: idOfTmcExercise(1), name: "hello" }] })),
    )
    vi.mocked(actions.downloadExerciseUpdates).mockResolvedValueOnce(
      Ok({
        updated: [],
        warnings: [
          {
            headline: "Failed to update hello.",
            error: new Error("not a package"),
            failedExercises: [idOfTmcExercise(1)],
          },
          { headline: "Failed to refresh local exercises.", error: new Error("disk") },
        ],
      }),
    )
    const shownHost = host()

    await courseDetailsHandlers.courseAction.handle(
      { type: "courseAction", sourcePanel: SOURCE, action: "updateExercises" },
      { host: shownHost, actionContext },
    )

    expect(vi.mocked(shownHost.post).mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "operationFailed",
        failure: expect.objectContaining({ title: "Failed to refresh local exercises." }),
      }),
    ])
  })

  test("updates nothing for a course that cannot be read", async function () {
    const actionContext = context()
    vi.mocked(buildCourseHomeView).mockReturnValue(Err(new Error("gone")))

    await courseAction(actionContext, "updateExercises")

    expect(actions.downloadExerciseUpdates).not.toHaveBeenCalled()
  })

  test("dismissing the AI policy notice forgets the change", async function () {
    recentPolicyChanges.add(COURSE, "AI may not be used at any point.")

    await courseAction(context(), "dismissAiPolicyChange")

    expect(recentPolicyChanges.get(COURSE)).toBeUndefined()
  })

  test("dismissing the update notice forgets what the automatic update replaced", async function () {
    recentUpdates.add(COURSE, ["hello"])

    await courseAction(context(), "dismissRecentUpdates")

    expect(recentUpdates.get(COURSE)).toEqual([])
  })
})
