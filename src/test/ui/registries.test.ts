import { Ok } from "ts-results"
import { afterEach, expect, onTestFinished, suite, test, vi } from "vitest"

import { BottleneckError } from "../../errors"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { downloadFailures } from "../../ui/downloadFailures"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { updateablesRegistry } from "../../ui/updateablesRegistry"

const tmcCourse = CourseIdentifier.from(1)
const otherTmcCourse = CourseIdentifier.from(2)
const moocCourse = CourseIdentifier.from("11111111-2222-3333-4444-555555555555")

afterEach(() => {
  updateablesRegistry.clear()
  downloadFailures.clear()
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

  test("keeps a tmc and a mooc course with the same id apart", () => {
    const tmc = [ExerciseIdentifier.from(101)]
    updateablesRegistry.set(CourseIdentifier.from(1), tmc)
    updateablesRegistry.set(CourseIdentifier.from("1"), [])

    expect(updateablesRegistry.get(CourseIdentifier.from(1))).toEqual(tmc)
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

  test("sets several courses as one change", () => {
    const changed = vi.fn()
    const subscription = updateablesRegistry.onDidChange(changed)

    updateablesRegistry.setMany([
      [tmcCourse, [ExerciseIdentifier.from(101)]],
      [moocCourse, []],
    ])
    subscription.dispose()

    expect(changed).toHaveBeenCalledOnce()
    expect(updateablesRegistry.get(tmcCourse)).toEqual([ExerciseIdentifier.from(101)])
  })
})

suite("download failures", () => {
  const first = ExerciseIdentifier.from(101)
  const second = ExerciseIdentifier.from(102)

  test("remembers a failure until the exercise is downloaded", () => {
    downloadFailures.record([first, second], [])
    downloadFailures.record([], [first])

    expect(downloadFailures.has(first)).toBe(false)
    expect(downloadFailures.has(second)).toBe(true)
  })

  test("keeps a tmc and a mooc exercise with the same id apart", () => {
    downloadFailures.record([ExerciseIdentifier.from(1)], [])

    expect(downloadFailures.has(ExerciseIdentifier.from("1"))).toBe(false)
  })

  test("announces every change", () => {
    const changed = vi.fn()
    const subscription = downloadFailures.onDidChange(changed)

    downloadFailures.record([first], [])
    downloadFailures.clear()
    subscription.dispose()

    expect(changed).toHaveBeenCalledTimes(2)
  })
})

suite("exercise operations", () => {
  const exercise = ExerciseIdentifier.from(101)
  const other = ExerciseIdentifier.from(102)

  test("reports an operation while it runs, and nothing after", async () => {
    let during: unknown
    await exerciseOperations.run(exercise, "testing", 60_000, async () => {
      during = exerciseOperations.current(exercise)
      return Ok.EMPTY
    })

    expect(during).toBe("testing")
    expect(exerciseOperations.current(exercise)).toBeUndefined()
  })

  test("refuses a conflicting operation on the same exercise, without running it", async () => {
    const work = vi.fn(async () => Ok.EMPTY)
    let refused: unknown
    await exerciseOperations.run(exercise, "submitting", 60_000, async () => {
      refused = await exerciseOperations.run(exercise, "pasting", 60_000, work)
      return Ok.EMPTY
    })

    expect(work).not.toHaveBeenCalled()
    expect(refused).toMatchObject({
      err: true,
      val: new BottleneckError("A submission for this exercise is already in progress."),
    })
  })

  test("lets unrelated operations, and other exercises, run alongside", async () => {
    let outcomes: boolean[] = []
    await exerciseOperations.run(exercise, "submitting", 60_000, async () => {
      const tested = await exerciseOperations.run(exercise, "testing", 60_000, async () => Ok.EMPTY)
      const otherSubmitted = await exerciseOperations.run(
        other,
        "submitting",
        60_000,
        async () => Ok.EMPTY,
      )
      outcomes = [tested.ok, otherSubmitted.ok]
      return Ok.EMPTY
    })

    expect(outcomes).toEqual([true, true])
  })

  test("claims several exercises all or none, and releases them one at a time", () => {
    const held = exerciseOperations.claim([exercise], "downloading", 60_000).unwrap()

    expect(exerciseOperations.claim([other, exercise], "downloading", 60_000).err).toBe(true)
    expect(exerciseOperations.isRunning(other, "downloading")).toBe(false)
    held.releaseAll()

    const both = exerciseOperations.claim([exercise, other], "downloading", 60_000).unwrap()
    both.release(exercise)
    expect(exerciseOperations.isRunning(exercise, "downloading")).toBe(false)
    expect(exerciseOperations.isRunning(other, "downloading")).toBe(true)
    both.releaseAll()
  })

  test("a failing operation still ends, and its error reaches the caller", async () => {
    await expect(
      exerciseOperations.run(exercise, "testing", 60_000, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    expect(exerciseOperations.current(exercise)).toBeUndefined()
  })

  test("gives up a claim held past its limit", () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const held = exerciseOperations.claim([exercise], "testing", 1000).unwrap()

    vi.advanceTimersByTime(1000)

    expect(exerciseOperations.current(exercise)).toBeUndefined()
    held.releaseAll()
  })
})
