import { vi } from "vitest"
import * as vscode from "vscode"

import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { registerTesting } from "../../init/testing"
import { activeTestController } from "../../testing/localTesting"
import { createMockActionContext } from "../mocks/actionContext"

const exercise: WorkspaceExercise = {
  backend: "tmc",
  courseSlug: "python-course",
  exerciseSlug: "part01-01_hello",
  status: ExerciseStatus.Open,
  uri: vscode.Uri.file("/tmc/python-course/part01-01_hello"),
}

function register(): {
  context: vscode.ExtensionContext
  exercises: WorkspaceExercise[]
  fireExercisesChanged: () => void
  commands: Map<string, (...args: unknown[]) => unknown>
} {
  const exercises: WorkspaceExercise[] = []
  const listeners: (() => void)[] = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((
    id: string,
    handler: (...args: unknown[]) => unknown,
  ) => {
    commands.set(id, handler)
    return new vscode.Disposable(() => {})
  }) as typeof vscode.commands.registerCommand)
  const workspaceManager = {
    activeCourse: "python-course",
    activeCourseBackend: "tmc",
    getExercisesByCourseSlug: () => exercises,
    onDidChangeExercises: (listener: () => void) => {
      listeners.push(listener)
      return new vscode.Disposable(() => {})
    },
  } as unknown as WorkspaceManager
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext
  registerTesting(context, createMockActionContext({ startup: { workspaceManager } }))
  return {
    context,
    exercises,
    fireExercisesChanged: () => listeners.forEach((listener) => listener()),
    commands,
  }
}

function controllerItems(): vscode.TestItemCollection {
  const controller = vi.mocked(vscode.tests.createTestController).mock.results.at(-1)?.value as {
    items: vscode.TestItemCollection
  }
  return controller.items
}

afterEach(function () {
  vi.restoreAllMocks()
})

suite("registerTesting", function () {
  test("keeps the test items in step with the workspace's exercises", function () {
    const { exercises, fireExercisesChanged } = register()
    expect(controllerItems().size).toBe(0)

    exercises.push(exercise)
    fireExercisesChanged()

    expect(controllerItems().get(exercise.uri.toString())?.label).toBe("part01-01_hello")
  })

  test("the test item commands forward the item's exercise folder", async function () {
    const { exercises, fireExercisesChanged, commands } = register()
    exercises.push(exercise)
    fireExercisesChanged()
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const item = controllerItems().get(exercise.uri.toString())

    await commands.get("tmc.testing.submitExercise")?.(item)
    await commands.get("tmc.testing.pasteExercise")?.(item)

    expect(executeCommand.mock.calls).toEqual([
      ["tmc.submitExercise", exercise.uri],
      ["tmc.pasteExercise", exercise.uri],
    ])
  })

  test("disposing the activation retires the controller", function () {
    const { context } = register()
    expect(activeTestController()).toBeDefined()

    for (const subscription of context.subscriptions) {
      subscription.dispose()
    }

    expect(activeTestController()).toBeUndefined()
  })
})
