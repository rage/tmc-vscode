import { vi } from "vitest"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { trackActiveEditorExercise, trackHasCourses } from "../../ui/contextKeys"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

suite("trackActiveEditorExercise", function () {
  let executeCommand: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  let editorChanged: () => void
  let workspaceManager: WorkspaceManager
  let workspace: WorkspaceManagerMockValues
  const exercisesChanged = (): void => workspace.exercisesChanged.fire()

  function track(): vscode.Disposable {
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(((
      listener: () => void,
    ) => {
      editorChanged = listener
      return new vscode.Disposable(() => {})
    }) as never)
    return trackActiveEditorExercise(workspaceManager)
  }

  function keyUpdates(): unknown[] {
    return executeCommand.mock.calls
      .filter(
        ([command, key]) =>
          command === "setContext" && key === "test-my-code:ActiveEditorIsExercise",
      )
      .map(([, , value]) => value)
  }

  beforeEach(function () {
    executeCommand = vi.fn(async () => undefined)
    vi.spyOn(vscode.commands, "executeCommand").mockImplementation(executeCommand)
    ;[workspaceManager, workspace] = createWorkspaceMangerMock()
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("sets the key from the editor open at start", function () {
    workspace.activeExercise = { exerciseSlug: "part01-01" } as WorkspaceExercise
    track()

    expect(keyUpdates()).toEqual([true])
  })

  test("follows the active editor, and exercises appearing under it", function () {
    track()
    workspace.activeExercise = { exerciseSlug: "part01-01" } as WorkspaceExercise
    editorChanged()
    workspace.activeExercise = undefined
    editorChanged()
    workspace.activeExercise = { exerciseSlug: "part01-02" } as WorkspaceExercise
    exercisesChanged()

    expect(keyUpdates()).toEqual([false, true, false, true])
  })

  test("writes the key only when it changes", function () {
    track()
    editorChanged()
    exercisesChanged()

    expect(keyUpdates()).toEqual([false])
  })
})

suite("trackHasCourses", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("sets the key from the stored courses, and on each change it makes", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    let courses: LocalCourseData[] = []
    const changed = new vscode.EventEmitter<undefined>()

    trackHasCourses({ getCourses: () => courses, onDidChangeCourses: changed.event })
    changed.fire(undefined)
    courses = [{} as LocalCourseData]
    changed.fire(undefined)
    changed.fire(undefined)
    courses = []
    changed.fire(undefined)

    const updates = executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "test-my-code:HasCourses")
      .map(([, , value]) => value)
    expect(updates).toEqual([false, true, false])
  })
})
