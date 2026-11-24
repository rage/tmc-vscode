import fs from "fs"
import path from "path"

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
      newExercises: "download",
      javaHome: " /usr/lib/jvm/java-21 ",
      "experimental.coursesMoocFi": true,
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

  test("a courses.mooc.fi setting change notifies the subscriber with the new value", async function () {
    const notified: boolean[] = []
    settings.onChangeCoursesMoocFiEnabled = (isEnabled): void => void notified.push(isEnabled)

    await changeSection("testMyCode.experimental.coursesMoocFi")

    expect(notified).toEqual([true])
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
    expect(settings.getNewExerciseHandling()).toBe("download")
    expect(settings.getJavaHome()).toBe("/usr/lib/jvm/java-21")
    expect(settings.isCoursesMoocFiEnabled()).toBe(true)
  })

  test("falls back to the declared defaults", function () {
    stubConfiguration({})

    expect(settings.getLogLevel()).toBe(LogLevel.Errors)
    expect(settings.getHideMetaFiles()).toBe(true)
    expect(settings.getDownloadOldSubmission()).toBe(true)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(true)
    expect(settings.getNewExerciseHandling()).toBe("ask")
    expect(settings.getJavaHome()).toBe("")
    expect(settings.isCoursesMoocFiEnabled()).toBe(false)
  })

  test("asks about new exercises when the setting holds an unknown value", function () {
    stubConfiguration({ newExercises: "sometimes" })

    expect(settings.getNewExerciseHandling()).toBe("ask")
  })

  test("disposing stops the configuration listener", function () {
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.results.at(-1)
      ?.value as vscode.Disposable
    const dispose = vi.spyOn(listener, "dispose")
    settings.dispose()

    expect(dispose).toHaveBeenCalled()
  })
})

suite("Settings defaults", function () {
  // Flipping the default is two independent edits; one alone changes what a fresh profile gets.
  test("the courses.mooc.fi setting's package.json default is the fallback Settings reads with", function () {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as {
      contributes: { configuration: { properties: Record<string, { default: unknown }> } }
    }
    const declared =
      manifest.contributes.configuration.properties["testMyCode.experimental.coursesMoocFi"]
    // A configuration that has no value of its own answers with the fallback.
    vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
      get: (_section: string, fallback?: unknown) => fallback,
    } as unknown as vscode.WorkspaceConfiguration)

    // Reads no instance state.
    expect(declared?.default).toBe(Settings.prototype.isCoursesMoocFiEnabled.call(undefined))
  })
})
