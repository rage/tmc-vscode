import { Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { closeExercises, downloadAndOpenExercises } from "../../actions"
import { downloadExercisesForUi } from "../../actions/downloadExercisesForUi"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"

vi.mock("../../actions/downloadExercisesForUi", () => ({
  downloadExercisesForUi: vi.fn(async () => Ok([])),
}))

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
  name: "mooc-python-course",
  title: "Mooc Python",
  description: null,
  organization: "mooc",
  exercises: [
    {
      id: "mooc-ex-uuid-1",
      name: "mooc_hello",
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
}

suite("closeExercises action", function () {
  test("closes a mooc exercise by its slug, not its raw uuid id", async function () {
    // Regression guard: `closeExercises` used to pass the mooc exercise's raw
    // uuid `id` where the workspace manager expects a slug.
    const closeCourseExercises = vi.fn(async () => Ok([]))
    const workspaceManager = {
      closeCourseExercises,
      getExercisesByCourseSlug: () => [],
    } as unknown as WorkspaceManager

    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData

    const langs = {
      setSetting: vi.fn(async () => Ok.EMPTY),
    } as unknown as Langs

    const actionContext = {
      workspaceManager: new Ok(workspaceManager),
      userData: new Ok(userData),
      langs: new Ok(langs),
    } as unknown as ActionContext

    await closeExercises(
      actionContext,
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )

    expect(closeCourseExercises).toHaveBeenCalledExactlyOnceWith("mooc", "mooc-python-course", [
      "mooc_hello",
    ])
  })
})

suite("downloadAndOpenExercises action", function () {
  // The local listing and the user's course catalogue agree on ids but not on
  // slugs: the same exercise is on disk as `mooc_hello_renamed`.
  const localListing = [
    {
      "course-slug": "mooc-python-course",
      "course-id": "instance-uuid-1",
      "exercise-slug": "mooc_hello_renamed",
      "exercise-id": "mooc-ex-uuid-1",
      "exercise-path": "/mooc/hello",
    },
  ]

  const contextFor = (listing: typeof localListing): ActionContext => {
    const workspaceManager = {
      openCourseExercises: vi.fn(async () => Ok.EMPTY),
      getExercisesByCourseSlug: () => [],
    } as unknown as WorkspaceManager
    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData
    const langs = {
      listLocalCourseExercises: vi.fn(async () => Ok(listing)),
      setSetting: vi.fn(async () => Ok.EMPTY),
    } as unknown as Langs
    return {
      workspaceManager: new Ok(workspaceManager),
      userData: new Ok(userData),
      langs: new Ok(langs),
      dialog: { errorNotification: vi.fn() },
    } as unknown as ActionContext
  }

  beforeEach(function () {
    vi.mocked(downloadExercisesForUi).mockClear()
  })

  test("does not re-download an exercise that is already on disk under another slug", async function () {
    await downloadAndOpenExercises(
      {} as vscode.ExtensionContext,
      contextFor(localListing),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).not.toHaveBeenCalled()
  })

  test("downloads an exercise the local listing does not report", async function () {
    await downloadAndOpenExercises(
      {} as vscode.ExtensionContext,
      contextFor([]),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).toHaveBeenCalledWith(
      expect.anything(),
      "",
      CourseIdentifier.from("instance-uuid-1"),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
    )
  })
})
