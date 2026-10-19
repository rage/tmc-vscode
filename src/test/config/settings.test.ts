import { vi } from "vitest"
import * as vscode from "vscode"

import Settings from "../../config/settings"
import { Logger, LogLevel } from "../../utilities/logger"

/** Stubs the `testMyCode` configuration with the effective values VS Code would answer. */
function stubConfiguration(effective: Record<string, unknown>): void {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: (section: string, fallback?: unknown) => effective[section] ?? fallback,
  } as unknown as vscode.WorkspaceConfiguration)
}

suite("Settings", function () {
  let settings: Settings
  let changed: (event: vscode.ConfigurationChangeEvent) => Promise<void>

  /** Drives the listener as VS Code does: one section reported as changed. */
  function changeSection(section: string): Promise<void> {
    return changed({ affectsConfiguration: (asked) => asked === section })
  }

  beforeEach(function () {
    stubConfiguration({
      logLevel: LogLevel.Verbose,
      hideMetaFiles: false,
      downloadOldSubmission: false,
      updateExercisesAutomatically: false,
      javaHome: " /usr/lib/jvm/java-21 ",
    })
    settings = new Settings()
    changed = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0] as never
  })

  afterEach(function () {
    settings.dispose()
    vi.restoreAllMocks()
  })

  test("a log level change reconfigures the logger", async function () {
    const configure = vi.spyOn(Logger, "configure").mockImplementation(() => {})
    await changeSection("testMyCode.logLevel")

    expect(configure).toHaveBeenCalledWith(LogLevel.Verbose)
  })

  test("a meta-file visibility change notifies the subscriber with the new value", async function () {
    const notified: boolean[] = []
    settings.onChangeHideMetaFiles = (hide): void => void notified.push(hide)

    await changeSection("testMyCode.hideMetaFiles")

    expect(notified).toEqual([false])
  })

  test("a change to an unrelated section notifies nobody", async function () {
    const configure = vi.spyOn(Logger, "configure").mockImplementation(() => {})
    const notified: boolean[] = []
    settings.onChangeHideMetaFiles = (hide): void => void notified.push(hide)

    await changeSection("editor.fontSize")

    expect(configure).not.toHaveBeenCalled()
    expect(notified).toEqual([])
  })

  test("reads every setting's effective value", function () {
    expect(settings.getLogLevel()).toBe(LogLevel.Verbose)
    expect(settings.getHideMetaFiles()).toBe(false)
    expect(settings.getDownloadOldSubmission()).toBe(false)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(false)
    expect(settings.getJavaHome()).toBe("/usr/lib/jvm/java-21")
  })

  test("falls back to the declared defaults", function () {
    stubConfiguration({})

    expect(settings.getLogLevel()).toBe(LogLevel.Errors)
    expect(settings.getHideMetaFiles()).toBe(true)
    expect(settings.getDownloadOldSubmission()).toBe(true)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(true)
    expect(settings.getJavaHome()).toBe("")
  })

  test("disposing stops the configuration listener", function () {
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.results.at(-1)
      ?.value as vscode.Disposable
    const dispose = vi.spyOn(listener, "dispose")
    settings.dispose()

    expect(dispose).toHaveBeenCalled()
  })
})
