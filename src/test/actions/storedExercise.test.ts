import { Err, Ok } from "ts-results"

import { storedExerciseOf } from "../../actions/storedExercise"
import type { UserData } from "../../config/userdata"
import { ExerciseRemovedError, presentationFor } from "../../errors"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

const exercise = {
  id: idOfMoocExercise("e1"),
  courseId: idOfMoocCourse("c1"),
  exerciseSlug: "c_beta",
}

function contextWith(userData: Partial<UserData>): ReturnType<typeof createMockActionContext> {
  return createMockActionContext({
    startup: {
      userData: {
        getExercise: () => Err(new Error("No stored mooc exercise e1.")),
        ...userData,
      } as unknown as UserData,
    },
  })
}

suite("storedExerciseOf", function () {
  test("says plainly that an exercise its course no longer lists was removed", function () {
    const stored = storedExerciseOf(contextWith({ getCourse: () => Ok({} as never) }), exercise)

    expect(stored.val).toBeInstanceOf(ExerciseRemovedError)
    expect(presentationFor(stored.val as Error)).toEqual({
      message:
        "c_beta was removed from the course, so it can no longer be submitted or restored. Its files stay on this computer, and Run Tests still works.",
      actions: [],
      isHeldBack: true,
    })
  })

  test("keeps the lookup's own error when the course itself is gone", function () {
    const stored = storedExerciseOf(
      contextWith({ getCourse: () => Err(new Error("no course")) }),
      exercise,
    )

    expect(stored.val).not.toBeInstanceOf(ExerciseRemovedError)
  })
})
