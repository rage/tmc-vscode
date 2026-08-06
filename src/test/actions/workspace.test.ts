import { Ok } from "ts-results"
import { vi } from "vitest"

import { closeExercises } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"

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
      getCourse: () => makeMoocKind(moocCourse) as LocalCourseData,
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
