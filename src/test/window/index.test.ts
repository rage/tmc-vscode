import * as vscode from "vscode"

import { getActiveEditorExecutablePath } from "../../window"
import { createMockActionContext } from "../mocks/actionContext"

const ACTIVE_ENVIRONMENT = "/home/student/.venvs/course/bin/python"
const CONFIGURED_INTERPRETER = "/usr/bin/python3"

const vscodeModule = vscode as unknown as { extensions: typeof vscode.extensions }

/** `vscode.extensions` is missing from the mock module altogether. */
function stubPythonExtension(extension: unknown): void {
  Object.defineProperty(vscodeModule, "extensions", {
    value: { getExtension: (id: string) => (id === "ms-python.python" ? extension : undefined) },
    configurable: true,
  })
}

function pythonExtension(exports: unknown, isActive = true): unknown {
  return { isActive, exports }
}

function environmentsApi(path: string | undefined): unknown {
  return { environments: { getActiveEnvironmentPath: () => (path ? { path } : undefined) } }
}

function openDocument(languageId: string): void {
  const document = { languageId, uri: vscode.Uri.file("/tmc/course/exercise/main.py") }
  Object.defineProperty(vscode.window, "activeTextEditor", {
    value: { document },
    configurable: true,
  })
}

function setConfiguredInterpreter(value: string | undefined): void {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: () => value,
  } as unknown as vscode.WorkspaceConfiguration)
}

suite("Active editor interpreter", function () {
  const actionContext = createMockActionContext()

  beforeEach(function () {
    openDocument("python")
    setConfiguredInterpreter(CONFIGURED_INTERPRETER)
  })

  afterEach(function () {
    vi.restoreAllMocks()
    Object.defineProperty(vscode.window, "activeTextEditor", {
      value: undefined,
      configurable: true,
    })
  })

  test("the environment the python extension has selected wins", function () {
    stubPythonExtension(pythonExtension(environmentsApi(ACTIVE_ENVIRONMENT)))

    expect(getActiveEditorExecutablePath(actionContext)).toBe(ACTIVE_ENVIRONMENT)
  })

  test("without the python extension, the configured interpreter is used", function () {
    stubPythonExtension(undefined)

    expect(getActiveEditorExecutablePath(actionContext)).toBe(CONFIGURED_INTERPRETER)
  })

  test("before the python extension activates, the configured interpreter is used", function () {
    stubPythonExtension(pythonExtension(environmentsApi(ACTIVE_ENVIRONMENT), false))

    expect(getActiveEditorExecutablePath(actionContext)).toBe(CONFIGURED_INTERPRETER)
  })

  test("with no environment selected, the configured interpreter is used", function () {
    stubPythonExtension(pythonExtension(environmentsApi(undefined)))

    expect(getActiveEditorExecutablePath(actionContext)).toBe(CONFIGURED_INTERPRETER)
  })

  test("with nothing to go on, the CLI is left to choose", function () {
    stubPythonExtension(pythonExtension(environmentsApi(undefined)))
    setConfiguredInterpreter(undefined)

    expect(getActiveEditorExecutablePath(actionContext)).toBeUndefined()
  })

  test("a python extension that throws does not break running tests", function () {
    stubPythonExtension(
      pythonExtension({
        environments: {
          getActiveEnvironmentPath: () => {
            throw new Error("python extension is shutting down")
          },
        },
      }),
    )

    expect(getActiveEditorExecutablePath(actionContext)).toBeUndefined()
  })

  test("a language with no interpreter to name resolves to nothing", function () {
    openDocument("java")
    stubPythonExtension(pythonExtension(environmentsApi(ACTIVE_ENVIRONMENT)))

    expect(getActiveEditorExecutablePath(actionContext)).toBeUndefined()
  })

  test("with no editor open there is nothing to resolve", function () {
    Object.defineProperty(vscode.window, "activeTextEditor", {
      value: undefined,
      configurable: true,
    })

    expect(getActiveEditorExecutablePath(actionContext)).toBeUndefined()
  })
})
