import { vi } from "vitest"
import * as vscode from "vscode"

import { BackgroundJobs } from "../../ui/backgroundJobs"
import type { FailedUpdate } from "../../ui/failedUpdates"
import { BackgroundStatusBarItem } from "../../ui/statusBarBackground"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { fakeStatusBarItems, tooltipText } from "../mocks/statusBar"

const NOT_A_PACKAGE =
  "The exercise on the server is not a valid exercise package; the course staff need to fix it."

function failure(exerciseName: string): FailedUpdate {
  return {
    courseId: idOfMoocCourse("course"),
    exerciseId: idOfMoocExercise(exerciseName),
    exerciseName,
    reason: NOT_A_PACKAGE,
  }
}

suite("BackgroundStatusBarItem", function () {
  let failed: FailedUpdate[]
  let changed: vscode.EventEmitter<void>
  let jobs: BackgroundJobs
  let disposables: vscode.Disposable[]

  beforeEach(function () {
    failed = []
    jobs = new BackgroundJobs()
    changed = new vscode.EventEmitter<void>()
    disposables = []
  })

  afterEach(function () {
    disposables.forEach((x) => x.dispose())
    vi.restoreAllMocks()
  })

  function createItem(): ReturnType<typeof fakeStatusBarItems>[number] {
    const created = fakeStatusBarItems()
    const statusBarItem = new BackgroundStatusBarItem({
      jobs,
      failedUpdates: { all: () => failed, onDidChange: changed.event },
    })
    disposables.push(statusBarItem)
    const [item] = created
    if (!item) {
      throw new Error("no status bar item was created")
    }
    return item
  }

  test("is hidden while no job runs and no update has failed", function () {
    expect(createItem().isShown).toBe(false)
  })

  test("names the exercise and says why in plain words, offering its course home", function () {
    failed = [failure("trivial")]

    const item = createItem()

    expect(item.isShown).toBe(true)
    expect(item.text).toBe("$(warning) Update failed: trivial")
    expect(tooltipText(item)).toContain(`Could not update trivial. ${NOT_A_PACKAGE}`)
    expect(item.command).toEqual({
      title: "Show Course",
      command: "tmc.courseDetails",
      arguments: [failed[0]!.courseId],
    })
  })

  test("counts several exercises", function () {
    failed = [failure("trivial"), failure("loops")]

    expect(createItem().text).toBe("$(warning) Update failed: 2 exercises")
  })

  test("goes away once the failures are gone", function () {
    failed = [failure("trivial")]
    const item = createItem()

    failed = []
    changed.fire()

    expect(item.isShown).toBe(false)
  })

  test("spins while a job runs, naming it, and opens its screen", async function () {
    const item = createItem()
    const courseId = idOfMoocCourse("course")
    let during = { text: "", command: undefined as vscode.Command | undefined }

    await jobs.run(
      { label: "Downloading 3 exercises", screen: { kind: "courseHome", courseId } },
      async () => {
        during = { text: item.text, command: item.command as vscode.Command }
      },
    )

    expect(during.text).toBe("$(sync~spin) TestMyCode: Downloading 3 exercises")
    expect(during.command).toEqual({
      title: "Show",
      command: "tmc.courseDetails",
      arguments: [courseId],
    })
    expect(item.isShown).toBe(false)
  })

  test("shows the job started last and how many more run", async function () {
    const item = createItem()
    const exerciseUri = vscode.Uri.file("/exercises/loops")
    let release!: () => void
    const refreshing = jobs.run(
      { label: "Refreshing courses", screen: { kind: "coursesView" } },
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    let during = { text: "", command: undefined as vscode.Command | undefined, tooltip: "" }

    await jobs.run(
      {
        label: "Waiting for grading of loops",
        screen: { kind: "results", exerciseId: idOfMoocExercise("loops"), exerciseUri },
      },
      async () => {
        during = {
          text: item.text,
          command: item.command as vscode.Command,
          tooltip: tooltipText(item),
        }
      },
    )

    expect(during.text).toBe("$(sync~spin) TestMyCode: Waiting for grading of loops (+1)")
    expect(during.command).toEqual({
      title: "Show",
      command: "tmc.showExerciseResults",
      arguments: [exerciseUri],
    })
    expect(during.tooltip).toContain("Refreshing courses")
    expect(item.text).toBe("$(sync~spin) TestMyCode: Refreshing courses")
    release()
    await refreshing
  })

  test("follows a job's new label", async function () {
    const item = createItem()
    const texts: string[] = []

    await jobs.run({ label: "Submitting loops", screen: { kind: "testResults" } }, async (job) => {
      texts.push(item.text)
      job.relabel("Waiting for grading of loops")
      texts.push(item.text)
    })

    expect(texts).toEqual([
      "$(sync~spin) TestMyCode: Submitting loops",
      "$(sync~spin) TestMyCode: Waiting for grading of loops",
    ])
  })

  test("shows a failed update once no job runs", async function () {
    failed = [failure("trivial")]
    const item = createItem()
    let during = ""

    await jobs.run({ label: "Checking for updates", screen: { kind: "coursesView" } }, async () => {
      during = item.text
    })

    expect(during).toBe("$(sync~spin) TestMyCode: Checking for updates")
    expect(item.text).toBe("$(warning) Update failed: trivial")
  })
})
