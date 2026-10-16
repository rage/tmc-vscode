import { vi } from "vitest"
import * as vscode from "vscode"

import type { FailedUpdate } from "../../ui/failedUpdates"
import { FailedUpdatesStatusBarItem } from "../../ui/statusBarFailedUpdates"
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

suite("FailedUpdatesStatusBarItem", function () {
  let failed: FailedUpdate[]
  let changed: vscode.EventEmitter<void>
  let disposables: vscode.Disposable[]

  beforeEach(function () {
    failed = []
    changed = new vscode.EventEmitter<void>()
    disposables = []
  })

  afterEach(function () {
    disposables.forEach((x) => x.dispose())
    vi.restoreAllMocks()
  })

  function createItem(): ReturnType<typeof fakeStatusBarItems>[number] {
    const created = fakeStatusBarItems()
    const statusBarItem = new FailedUpdatesStatusBarItem({
      all: () => failed,
      onDidChange: changed.event,
    })
    disposables.push(statusBarItem)
    const [item] = created
    if (!item) {
      throw new Error("no status bar item was created")
    }
    return item
  }

  test("is hidden while no update has failed", function () {
    expect(createItem().isShown).toBe(false)
  })

  test("names the exercise and says why in plain words, offering to check again", function () {
    failed = [failure("trivial")]

    const item = createItem()

    expect(item.isShown).toBe(true)
    expect(item.text).toBe("$(warning) Update failed: trivial")
    expect(tooltipText(item)).toContain(`Could not update trivial. ${NOT_A_PACKAGE}`)
    expect(item.command).toBe("tmc.updateExercises")
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
})
