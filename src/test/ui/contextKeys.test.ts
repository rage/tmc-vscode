import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../../shared/lib"
import { makeMoocKind } from "../../../shared/lib"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import {
  trackActiveEditorExercise,
  trackActiveExerciseRemoved,
  trackActiveExerciseSubmitRefused,
  trackHasCourses,
  trackHasDownloadedExercises,
} from "../../ui/contextKeys"
import { moocCourseExercise, moocLocalCourse } from "../fixtures/courses"
import { idOfMoocExercise } from "../fixtures/identifiers"
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

suite("trackHasDownloadedExercises", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("sets the key from the exercises on disk, and on each change of them", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const [workspaceManager, workspace] = createWorkspaceMangerMock()
    workspace.getExercises = []

    trackHasDownloadedExercises(workspaceManager)
    workspace.getExercises = [workspace.getExercisesByCoursePythonCourse[0]!]
    workspace.exercisesChanged.fire()

    const updates = executeCommand.mock.calls
      .filter(
        ([command, key]) =>
          command === "setContext" && key === "test-my-code:HasDownloadedExercises",
      )
      .map(([, , value]) => value)
    expect(updates).toEqual([false, true])
  })
})

suite("trackActiveExerciseRemoved", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("is set while the active exercise's course is stored but no longer lists it", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(
      (() => new vscode.Disposable(() => {})) as never,
    )
    const [workspaceManager, workspace] = createWorkspaceMangerMock()
    workspace.activeExercise = { id: idOfMoocExercise("e1") } as WorkspaceExercise
    let isListed = true
    const changed = new vscode.EventEmitter<undefined>()

    trackActiveExerciseRemoved(workspaceManager, {
      getExercise: () => (isListed ? Ok({} as never) : Err(new Error("No stored exercise"))),
      getCourse: () => Ok({} as never),
      onDidChangeCourses: changed.event,
    })
    isListed = false
    changed.fire(undefined)

    const updates = executeCommand.mock.calls
      .filter(
        ([command, key]) =>
          command === "setContext" && key === "test-my-code:ActiveExerciseRemoved",
      )
      .map(([, , value]) => value)
    expect(updates).toEqual([false, true])
  })
})

suite("trackActiveExerciseSubmitRefused", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("is set while the backend would refuse a submission of the active exercise", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(
      (() => new vscode.Disposable(() => {})) as never,
    )
    const [workspaceManager, workspace] = createWorkspaceMangerMock()
    workspace.activeExercise = { id: idOfMoocExercise("e1") } as WorkspaceExercise
    let triesLeft = 1
    const changed = new vscode.EventEmitter<undefined>()

    trackActiveExerciseSubmitRefused(workspaceManager, {
      getExercise: () =>
        Ok({
          course: moocLocalCourse(),
          exercise: makeMoocKind(moocCourseExercise({ id: "e1", triesLeft, maxTries: 2 })),
        }),
      onDidChangeCourses: changed.event,
    })
    triesLeft = 0
    changed.fire(undefined)

    const updates = executeCommand.mock.calls
      .filter(
        ([command, key]) =>
          command === "setContext" && key === "test-my-code:ActiveExerciseSubmitRefused",
      )
      .map(([, , value]) => value)
    expect(updates).toEqual([false, true])
  })
})
