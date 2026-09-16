import { afterEach, expect, suite, test, vi } from "vitest"

import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"

vi.mock("../../panels/TmcPanel", () => ({
  TmcPanel: { postMessage: vi.fn() },
}))

import { TmcPanel } from "../../panels/TmcPanel"
import { postUpdateables, updateablesRegistry } from "../../panels/updateablesRegistry"

const tmcCourse = CourseIdentifier.from(1)
const otherTmcCourse = CourseIdentifier.from(2)
const moocCourse = CourseIdentifier.from("11111111-2222-3333-4444-555555555555")

afterEach(() => {
  updateablesRegistry.clear()
  vi.mocked(TmcPanel.postMessage).mockClear()
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
