import { afterEach, expect, suite, test, vi } from "vitest"

import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { exerciseStatusRegistry } from "../../ui/exerciseStatusRegistry"
import { updateablesRegistry } from "../../ui/updateablesRegistry"

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

    updateablesRegistry.set(tmcCourse, first)
    updateablesRegistry.set(otherTmcCourse, second)
    updateablesRegistry.set(moocCourse, mooc)

    expect(updateablesRegistry.get(tmcCourse)).toEqual(first)
    expect(updateablesRegistry.get(otherTmcCourse)).toEqual(second)
    expect(updateablesRegistry.get(moocCourse)).toEqual(mooc)
  })

  test("a later set replaces the course's list rather than adding to it", () => {
    updateablesRegistry.set(tmcCourse, [ExerciseIdentifier.from(101)])
    updateablesRegistry.set(tmcCourse, [])

    expect(updateablesRegistry.get(tmcCourse)).toEqual([])
  })

  test("looks up by value, not by object identity", () => {
    updateablesRegistry.set(CourseIdentifier.from(1), [ExerciseIdentifier.from(101)])

    expect(updateablesRegistry.get(CourseIdentifier.from(1))).toHaveLength(1)
  })

  test("announces every change", () => {
    const changed = vi.fn()
    const subscription = updateablesRegistry.onDidChange(changed)

    updateablesRegistry.set(tmcCourse, [])
    updateablesRegistry.clear()
    subscription.dispose()

    expect(changed).toHaveBeenCalledTimes(2)
  })
})

suite("exercise status registry", () => {
  const first = ExerciseIdentifier.from(101)
  const second = ExerciseIdentifier.from(102)

  test("keeps the statuses the workspace cannot derive, per course", () => {
    exerciseStatusRegistry.record(tmcCourse, [
      [first, "downloading"],
      [second, "downloadFailed"],
    ])
    exerciseStatusRegistry.record(otherTmcCourse, [[first, "downloading"]])

    expect(exerciseStatusRegistry.get(CourseIdentifier.from(1))).toEqual([
      [first, "downloading"],
      [second, "downloadFailed"],
    ])
    expect(exerciseStatusRegistry.get(otherTmcCourse)).toEqual([[first, "downloading"]])
  })

  test("forgets an exercise once it settles", () => {
    exerciseStatusRegistry.record(tmcCourse, [
      [first, "downloading"],
      [second, "downloading"],
    ])

    exerciseStatusRegistry.record(tmcCourse, [[first, "closed"]])

    expect(exerciseStatusRegistry.get(tmcCourse)).toEqual([[second, "downloading"]])
  })

  test("announces every change", () => {
    const changed = vi.fn()
    const subscription = exerciseStatusRegistry.onDidChange(changed)

    exerciseStatusRegistry.record(moocCourse, [[first, "downloading"]])
    exerciseStatusRegistry.clear()
    subscription.dispose()

    expect(changed).toHaveBeenCalledTimes(2)
  })
})
