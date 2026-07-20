import * as vscode from "vscode"

import ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { userDataExerciseHelloWorld } from "../fixtures/userData"
import { exerciseHelloWorld } from "../fixtures/workspaceManager"
import type { UserDataMockValues } from "../mocks/userdata"
import { createUserDataMock } from "../mocks/userdata"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

suite("ExerciseDecoratorProvider class", function () {
  let userDataMock: UserData
  let userDataMockValues: UserDataMockValues
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  let exerciseDecorationProvider: ExerciseDecorationProvider

  beforeEach(function () {
    ;[userDataMock, userDataMockValues] = createUserDataMock()
    userDataMockValues.getExerciseByName = userDataExerciseHelloWorld
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
    workspaceManagerMockValues.getExerciseByPath = exerciseHelloWorld

    exerciseDecorationProvider = new ExerciseDecorationProvider(userDataMock, workspaceManagerMock)
  })

  test("should decorate passed exercise with a filled circle", function () {
    userDataMockValues.getExerciseByName = { ...userDataExerciseHelloWorld, passed: true }
    const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri)
    expect((decoration as vscode.FileDecoration).badge).toBe("⬤")
  })

  test("should decorate expired exercise with an X mark", function () {
    const expiredExercise = { ...userDataExerciseHelloWorld, deadline: "1970-01-01" }
    userDataMockValues.getExerciseByName = expiredExercise
    const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri)
    expect((decoration as vscode.FileDecoration).badge).toBe("✗")
  })

  test("should decorate partially completed exercise with small circle", function () {
    const partialCompletion = {
      ...userDataExerciseHelloWorld,
      awardedPoints: 1,
      passed: false,
    }
    userDataMockValues.getExerciseByName = partialCompletion
    const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri)
    expect((decoration as vscode.FileDecoration).badge).toBe("○")
  })

  test("should decorate exercise missing from UserData with information symbol", function () {
    userDataMockValues.getExerciseByName = undefined
    const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri)
    expect((decoration as vscode.FileDecoration).badge).toBe("ⓘ")
  })

  test("should not decorate valid exercise that isn't yet passed", function () {
    userDataMockValues.getExerciseByName = { ...userDataExerciseHelloWorld, passed: false }
    const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri)
    expect(decoration).toBeUndefined()
  })

  test("should not decorate exercise folder subitem", function () {
    const rootUri = vscode.Uri.file("/tmc/vscode/test-python-course/hello_world")
    const subUri = vscode.Uri.file("/tmc/vscode/test-python-course/hello_world/src/hello.py")
    workspaceManagerMockValues.getExerciseByPath = { ...exerciseHelloWorld, uri: rootUri }
    const decoration = exerciseDecorationProvider.provideFileDecoration(subUri)
    expect(decoration).toBeUndefined()
  })

  test("should not attempt to decorate a non-exercise", function () {
    const notExercise = vscode.Uri.file("something.txt")
    const decoration = exerciseDecorationProvider.provideFileDecoration(notExercise)
    expect(decoration).toBeUndefined()
    expect(userDataMock.getTmcExerciseByName).not.toHaveBeenCalled()
  })
})
