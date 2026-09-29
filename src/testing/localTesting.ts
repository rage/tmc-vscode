import * as vscode from "vscode"

import type { ExerciseTestController } from "./exerciseTestController"

let active: ExerciseTestController | undefined

/** The activation's test controller; `undefined` before `registerTesting` or after dispose. */
export function activeTestController(): ExerciseTestController | undefined {
  return active
}

/** Makes `controller` the active one until the returned disposable is disposed. */
export function setActiveTestController(controller: ExerciseTestController): vscode.Disposable {
  active = controller
  return new vscode.Disposable(() => {
    if (active === controller) {
      active = undefined
    }
  })
}
