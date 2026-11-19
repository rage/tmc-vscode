import { Ok } from "ts-results"
import { vi } from "vitest"

import type { LocalCourseData } from "../../../shared/lib"
import { makeMoocKind } from "../../../shared/lib"
import { closeExercises } from "../../actions/closeExercises"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import type { MoocLocalCourseData } from "../../storage/data"
import { moocCourseData, moocCourseExercise } from "../fixtures/courses"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

const moocCourse: MoocLocalCourseData = moocCourseData({
  id: "instance-uuid-1",
  name: "mooc-python-course",
  title: "Mooc Python",
  availablePoints: 1,
  exercises: [moocCourseExercise({ id: "mooc-ex-uuid-1", name: "mooc_hello" })],
})

suite("closeExercises action", function () {
  test("closes the course's exercises by id and answers with the ids it closed", async function () {
    const id = idOfMoocExercise("mooc-ex-uuid-1")
    const closeCourseExercises = vi.fn(async () => Ok([{ id }]))
    const workspaceManager = { closeCourseExercises } as unknown as WorkspaceManager
    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData
    const actionContext = createMockActionContext({ startup: { userData, workspaceManager } })

    const result = await closeExercises(actionContext, [id], idOfMoocCourse("instance-uuid-1"))

    expect(closeCourseExercises).toHaveBeenCalledExactlyOnceWith("mooc", "mooc-python-course", [id])
    expect(result.unwrap()).toEqual([id])
  })
})
