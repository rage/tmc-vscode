import * as vscode from "vscode"

import { createExerciseActivity } from "../../ui/statusBarActivity"

suite("createExerciseActivity", function () {
  const exercise = vscode.Uri.file("/course/part01-01")
  const other = vscode.Uri.file("/course/part01-02")

  test("reports an activity while its work runs, and nothing after", async function () {
    const activity = createExerciseActivity()
    let observed: unknown
    await activity.run(exercise, "testing", async () => {
      observed = activity.current(exercise)
    })

    expect(observed).toBe("testing")
    expect(activity.current(exercise)).toBeUndefined()
  })

  test("keys by exercise", async function () {
    const activity = createExerciseActivity()
    let observed: unknown = "unset"
    await activity.run(exercise, "submitting", async () => {
      observed = activity.current(other)
    })

    expect(observed).toBeUndefined()
  })

  test("a failing run still ends, and its error reaches the caller", async function () {
    const activity = createExerciseActivity()

    await expect(
      activity.run(exercise, "testing", async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(activity.current(exercise)).toBeUndefined()
  })

  test("overlapping runs show the latest, then the one still running", async function () {
    const activity = createExerciseActivity()
    const { promise: testsDone, resolve: finishTests } = Promise.withResolvers<void>()
    const tests = activity.run(exercise, "testing", () => testsDone)
    let duringSubmit: unknown
    await activity.run(exercise, "submitting", async () => {
      duringSubmit = activity.current(exercise)
    })

    expect(duringSubmit).toBe("submitting")
    expect(activity.current(exercise)).toBe("testing")
    finishTests()
    await tests
    expect(activity.current(exercise)).toBeUndefined()
  })

  test("fires a change when a run starts and when it ends", async function () {
    const activity = createExerciseActivity()
    let changes = 0
    activity.onDidChange(() => (changes += 1))

    await activity.run(exercise, "testing", async () => {})

    expect(changes).toBe(2)
  })
})
