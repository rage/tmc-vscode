import { Ok } from "ts-results"
import { afterEach, expect, suite, test, vi } from "vitest"

import { BottleneckError } from "../../errors"
import { downloadFailures } from "../../ui/downloadFailures"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"

const tmcCourse = idOfTmcCourse(1)
const otherTmcCourse = idOfTmcCourse(2)
const moocCourse = idOfMoocCourse("11111111-2222-3333-4444-555555555555")

afterEach(() => {
  updateablesRegistry.clear()
  downloadFailures.clear()
})

suite("updateables registry", () => {
  test("an unknown course has no updateables", () => {
    expect(updateablesRegistry.get(tmcCourse)).toEqual([])
  })

  test("keeps courses apart, including across backends", () => {
    const first = [idOfTmcExercise(101)]
    const second = [idOfTmcExercise(202)]
    const mooc = [idOfMoocExercise("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")]

    updateablesRegistry.setMany([[tmcCourse, first]])
    updateablesRegistry.setMany([[otherTmcCourse, second]])
    updateablesRegistry.setMany([[moocCourse, mooc]])

    expect(updateablesRegistry.get(tmcCourse)).toEqual(first)
    expect(updateablesRegistry.get(otherTmcCourse)).toEqual(second)
    expect(updateablesRegistry.get(moocCourse)).toEqual(mooc)
  })

  test("keeps a tmc and a mooc course with the same id apart", () => {
    const tmc = [idOfTmcExercise(101)]
    updateablesRegistry.setMany([[idOfTmcCourse(1), tmc]])
    updateablesRegistry.setMany([[idOfMoocCourse("1"), []]])

    expect(updateablesRegistry.get(idOfTmcCourse(1))).toEqual(tmc)
  })

  test("a later list replaces the course's list rather than adding to it", () => {
    updateablesRegistry.setMany([[tmcCourse, [idOfTmcExercise(101)]]])
    updateablesRegistry.setMany([[tmcCourse, []]])

    expect(updateablesRegistry.get(tmcCourse)).toEqual([])
  })

  test("looks up by value, not by object identity", () => {
    updateablesRegistry.setMany([[idOfTmcCourse(1), [idOfTmcExercise(101)]]])

    expect(updateablesRegistry.get(idOfTmcCourse(1))).toHaveLength(1)
  })

  test("announces every change", () => {
    const changed = vi.fn()
    const subscription = updateablesRegistry.onDidChange(changed)

    updateablesRegistry.setMany([[tmcCourse, []]])
    updateablesRegistry.clear()
    subscription.dispose()

    expect(changed).toHaveBeenCalledTimes(2)
  })

  test("sets several courses as one change", () => {
    const changed = vi.fn()
    const subscription = updateablesRegistry.onDidChange(changed)

    updateablesRegistry.setMany([
      [tmcCourse, [idOfTmcExercise(101)]],
      [moocCourse, []],
    ])
    subscription.dispose()

    expect(changed).toHaveBeenCalledOnce()
    expect(updateablesRegistry.get(tmcCourse)).toEqual([idOfTmcExercise(101)])
  })
})

suite("download failures", () => {
  const first = idOfTmcExercise(101)
  const second = idOfTmcExercise(102)

  test("remembers a failure until the exercise is downloaded", () => {
    downloadFailures.record([first, second], [])
    downloadFailures.record([], [first])

    expect(downloadFailures.has(first)).toBe(false)
    expect(downloadFailures.has(second)).toBe(true)
  })

  test("keeps a tmc and a mooc exercise with the same id apart", () => {
    downloadFailures.record([idOfTmcExercise(1)], [])

    expect(downloadFailures.has(idOfMoocExercise("1"))).toBe(false)
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
  const exercise = idOfTmcExercise(101)
  const other = idOfTmcExercise(102)

  test("reports an operation while it runs, and nothing after", async () => {
    let during: unknown
    await exerciseOperations.run(exercise, "testing", async () => {
      during = exerciseOperations.current(exercise)
      return Ok.EMPTY
    })

    expect(during).toBe("testing")
    expect(exerciseOperations.current(exercise)).toBeUndefined()
  })

  test("refuses a conflicting operation on the same exercise, without running it", async () => {
    const work = vi.fn(async () => Ok.EMPTY)
    let refused: unknown
    await exerciseOperations.run(exercise, "submitting", async () => {
      refused = await exerciseOperations.run(exercise, "pasting", work)
      return Ok.EMPTY
    })

    expect(work).not.toHaveBeenCalled()
    expect(refused).toMatchObject({
      err: true,
      val: new BottleneckError("A submission for this exercise is already in progress."),
    })
  })

  test.each([
    ["downloading", "submitting"],
    ["downloading", "resetting"],
    ["testing", "submitting"],
    ["testing", "pasting"],
    ["testing", "restoring"],
    ["submitting", "testing"],
    ["resetting", "downloading"],
  ] as const)("refuses %s and %s overlapping on one exercise", async (running, requested) => {
    let refused: unknown
    await exerciseOperations.run(exercise, running, async () => {
      refused = await exerciseOperations.run(exercise, requested, async () => Ok.EMPTY)
      return Ok.EMPTY
    })

    expect(refused).toMatchObject({ err: true })
  })

  test("names the running operation when refusing another", async () => {
    let refused: unknown
    await exerciseOperations.run(exercise, "testing", async () => {
      refused = await exerciseOperations.run(exercise, "submitting", async () => Ok.EMPTY)
      return Ok.EMPTY
    })

    expect(refused).toMatchObject({
      val: new BottleneckError("Tests are already running for this exercise."),
    })
  })

  test("lets other exercises run alongside", async () => {
    let otherSubmitted: unknown
    await exerciseOperations.run(exercise, "submitting", async () => {
      otherSubmitted = await exerciseOperations.run(other, "submitting", async () => Ok.EMPTY)
      return Ok.EMPTY
    })

    expect(otherSubmitted).toMatchObject({ ok: true })
  })

  test("claims several exercises all or none, and releases them one at a time", () => {
    const held = exerciseOperations.claim([exercise], "downloading").unwrap()

    expect(exerciseOperations.claim([other, exercise], "downloading").err).toBe(true)
    expect(exerciseOperations.isRunning(other, "downloading")).toBe(false)
    held.releaseAll()

    const both = exerciseOperations.claim([exercise, other], "downloading").unwrap()
    both.release(exercise)
    expect(exerciseOperations.isRunning(exercise, "downloading")).toBe(false)
    expect(exerciseOperations.isRunning(other, "downloading")).toBe(true)
    both.releaseAll()
  })

  test("a failing operation still ends, and its error reaches the caller", async () => {
    await expect(
      exerciseOperations.run(exercise, "testing", async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    expect(exerciseOperations.current(exercise)).toBeUndefined()
  })
})
