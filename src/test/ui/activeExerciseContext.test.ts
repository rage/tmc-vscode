import { vi } from "vitest"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { trackActiveEditorExercise } from "../../ui/activeExerciseContext"

suite("trackActiveEditorExercise", function () {
  let executeCommand: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  let editorChanged: () => void
  let exercisesChanged: () => void
  let activeExercise: WorkspaceExercise | undefined

  function track(): vscode.Disposable {
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(((
      listener: () => void,
    ) => {
      editorChanged = listener
      return new vscode.Disposable(() => {})
    }) as never)
    return trackActiveEditorExercise({
      get activeExercise() {
        return activeExercise
      },
      onDidChangeExercises: ((listener: () => void) => {
        exercisesChanged = listener
        return new vscode.Disposable(() => {})
      }) as never,
    })
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
    activeExercise = undefined
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("sets the key from the editor open at start", function () {
    activeExercise = { exerciseSlug: "part01-01" } as WorkspaceExercise
    track()

    expect(keyUpdates()).toEqual([true])
  })

  test("follows the active editor, and exercises appearing under it", function () {
    track()
    activeExercise = { exerciseSlug: "part01-01" } as WorkspaceExercise
    editorChanged()
    activeExercise = undefined
    editorChanged()
    activeExercise = { exerciseSlug: "part01-02" } as WorkspaceExercise
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
