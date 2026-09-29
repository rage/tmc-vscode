import * as vscode from "vscode"

import type { CheckstyleDiagnostics } from "./checkstyleDiagnostics"

/** What reports local test runs to the editor, once activation has set it up. */
export interface LocalTesting {
  diagnostics: CheckstyleDiagnostics
}

let active: LocalTesting | undefined

/** The activation's {@link LocalTesting}; `undefined` before `registerTesting` or after dispose. */
export function activeLocalTesting(): LocalTesting | undefined {
  return active
}

/** Makes `testing` the active one until the returned disposable is disposed. */
export function setActiveLocalTesting(testing: LocalTesting): vscode.Disposable {
  active = testing
  return new vscode.Disposable(() => {
    if (active === testing) {
      active = undefined
    }
  })
}
