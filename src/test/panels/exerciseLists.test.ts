import { afterEach, expect, suite, test, vi } from "vitest"

import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"

vi.mock("../../panels/TmcPanel", () => ({
  TmcPanel: { postMessage: vi.fn() },
}))

import {
  postExerciseStatus,
  postExerciseStatuses,
  postUpdateables,
} from "../../panels/exerciseLists"
import { exerciseStatusRegistry } from "../../panels/exerciseStatusRegistry"
import { TmcPanel } from "../../panels/TmcPanel"
import { updateablesRegistry } from "../../panels/updateablesRegistry"

const tmcCourse = CourseIdentifier.from(1)
const otherTmcCourse = CourseIdentifier.from(2)
const moocCourse = CourseIdentifier.from("11111111-2222-3333-4444-555555555555")

afterEach(() => {
  updateablesRegistry.clear()
  exerciseStatusRegistry.clear()
})

suite("updateables registry", () => {
  test("an unknown course has no updateables", () => {
    expect(updateablesRegistry.get(tmcCourse)).toEqual([])
  })

  test("keeps courses apart, including across backends", () => {
    const first = [ExerciseIdentifier.from(101)]
    const second = [ExerciseIdentifier.from(202)]
    const mooc = [ExerciseIdentifier.from("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")]

    postUpdateables(tmcCourse, first)
    postUpdateables(otherTmcCourse, second)
    postUpdateables(moocCourse, mooc)

    expect(updateablesRegistry.get(tmcCourse)).toEqual(first)
    expect(updateablesRegistry.get(otherTmcCourse)).toEqual(second)
    expect(updateablesRegistry.get(moocCourse)).toEqual(mooc)
  })

  test("a later post replaces the course's list rather than adding to it", () => {
    postUpdateables(tmcCourse, [ExerciseIdentifier.from(101)])
    postUpdateables(tmcCourse, [])

    expect(updateablesRegistry.get(tmcCourse)).toEqual([])
  })

  test("looks up by value, not by object identity", () => {
    postUpdateables(CourseIdentifier.from(1), [ExerciseIdentifier.from(101)])

    // the request handler reads with an identifier rebuilt from the panel, never the
    // object the producer posted
    expect(updateablesRegistry.get(CourseIdentifier.from(1))).toHaveLength(1)
  })

  test("posting and recording happen together, so the two cannot drift", () => {
    const exerciseIds = [ExerciseIdentifier.from(101)]
    postUpdateables(tmcCourse, exerciseIds)

    expect(TmcPanel.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: tmcCourse,
      exerciseIds,
    })
    expect(updateablesRegistry.get(tmcCourse)).toEqual(exerciseIds)
  })
})

suite("exercise status registry", () => {
  const first = ExerciseIdentifier.from(101)
  const second = ExerciseIdentifier.from(102)

  test("keeps the statuses the workspace cannot derive, per course", () => {
    postExerciseStatuses(tmcCourse, [
      [first, "downloading"],
      [second, "downloadFailed"],
    ])
    postExerciseStatuses(otherTmcCourse, [[first, "downloading"]])

    expect(exerciseStatusRegistry.get(CourseIdentifier.from(1))).toEqual([
      [first, "downloading"],
      [second, "downloadFailed"],
    ])
    expect(exerciseStatusRegistry.get(otherTmcCourse)).toEqual([[first, "downloading"]])
  })

  test("forgets an exercise once it settles", () => {
    postExerciseStatuses(tmcCourse, [
      [first, "downloading"],
      [second, "downloading"],
    ])

    postExerciseStatus(tmcCourse, first, "closed")

    expect(exerciseStatusRegistry.get(tmcCourse)).toEqual([[second, "downloading"]])
  })

  test("posts a batch as one message", () => {
    const statuses: [ExerciseIdentifier, "downloading"][] = [
      [first, "downloading"],
      [second, "downloading"],
    ]

    postExerciseStatuses(moocCourse, statuses)

    expect(TmcPanel.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "setExerciseStatuses",
      target: { type: "CourseDetails" },
      courseId: moocCourse,
      statuses,
    })
  })
})
