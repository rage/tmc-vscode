import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { storedExerciseOf } from "../../actions/storedExercise"
import type { UserData } from "../../config/userdata"
import { ChapterNotOpenError, ExerciseRemovedError, presentationFor } from "../../errors"
import { moocCourseExercise, moocLocalCourse } from "../fixtures/courses"
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
  // jest-mock-vscode ships no `env` namespace.
  beforeAll(function () {
    const vscodeModule: object = vscode
    Object.defineProperty(vscodeModule, "env", { value: { language: "en" }, configurable: true })
  })

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

  test("says an exercise hidden until its chapter opens is not removed, and names the chapter", function () {
    const course = moocLocalCourse({
      closedChapters: [
        {
          name: "Recursion",
          number: 3,
          opensAt: "2100-01-01T00:00:00Z",
          exercises: [moocCourseExercise({ id: "e1", name: "c_beta" })],
        },
      ],
    })
    const stored = storedExerciseOf(contextWith({ getCourse: () => Ok(course) }), exercise)

    expect(stored.val).toBeInstanceOf(ChapterNotOpenError)
    expect((stored.val as Error).message).toMatch(
      /^c_beta is in the chapter "Recursion", which opens on .+\. Until then it can't be submitted\./,
    )
  })

  test("keeps the lookup's own error when the course itself is gone", function () {
    const stored = storedExerciseOf(
      contextWith({ getCourse: () => Err(new Error("no course")) }),
      exercise,
    )

    expect(stored.val).not.toBeInstanceOf(ExerciseRemovedError)
  })
})
