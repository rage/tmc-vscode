import * as vscode from "vscode"

import { resolvePythonInterpreter } from "../../window"

const ACTIVE_ENVIRONMENT = "/home/student/.venvs/course/bin/python"
const CONFIGURED_INTERPRETER = "/usr/bin/python3"
const EXERCISE_URI = vscode.Uri.file("/tmc/course/exercise")

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

function environmentsApi(
  path: string | undefined,
  getActiveEnvironmentPath = vi.fn(() => (path ? { path } : undefined)),
): unknown {
  return { environments: { getActiveEnvironmentPath } }
}

function setConfiguredInterpreter(value: string | undefined): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: () => value,
  } as unknown as vscode.WorkspaceConfiguration)
}

suite("Exercise python interpreter", function () {
  beforeEach(function () {
    setConfiguredInterpreter(CONFIGURED_INTERPRETER)
  })

  afterEach(function () {
    vi.restoreAllMocks()
    Object.defineProperty(vscode.window, "activeTextEditor", {
      value: undefined,
      configurable: true,
    })
  })

  test("the environment the python extension selected for the exercise wins", function () {
    const getActiveEnvironmentPath = vi.fn(() => ({ path: ACTIVE_ENVIRONMENT }))
    stubPythonExtension(pythonExtension(environmentsApi(undefined, getActiveEnvironmentPath)))

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBe(ACTIVE_ENVIRONMENT)
    expect(getActiveEnvironmentPath).toHaveBeenCalledWith(EXERCISE_URI)
  })

  test("does not depend on which editor is active", function () {
    Object.defineProperty(vscode.window, "activeTextEditor", {
      value: { document: { languageId: "java", uri: vscode.Uri.file("/elsewhere/Main.java") } },
      configurable: true,
    })
    stubPythonExtension(pythonExtension(environmentsApi(ACTIVE_ENVIRONMENT)))

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBe(ACTIVE_ENVIRONMENT)
  })

  test("without the python extension, the interpreter configured for the exercise is used", function () {
    stubPythonExtension(undefined)
    const getConfiguration = setConfiguredInterpreter(CONFIGURED_INTERPRETER)

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBe(CONFIGURED_INTERPRETER)
    expect(getConfiguration).toHaveBeenCalledWith("python", EXERCISE_URI)
  })

  test("before the python extension activates, the configured interpreter is used", function () {
    stubPythonExtension(pythonExtension(environmentsApi(ACTIVE_ENVIRONMENT), false))

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBe(CONFIGURED_INTERPRETER)
  })

  test("with no environment selected, the configured interpreter is used", function () {
    stubPythonExtension(pythonExtension(environmentsApi(undefined)))

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBe(CONFIGURED_INTERPRETER)
  })

  test("with nothing to go on, the CLI is left to choose", function () {
    stubPythonExtension(pythonExtension(environmentsApi(undefined)))
    setConfiguredInterpreter(undefined)

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBeUndefined()
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

    expect(resolvePythonInterpreter(EXERCISE_URI)).toBeUndefined()
  })
})
