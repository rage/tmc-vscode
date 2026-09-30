import { vi } from "vitest"
import * as vscode from "vscode"

import Settings from "../../config/settings"
import { Logger, LogLevel } from "../../utilities/logger"

/** One VS Code setting as the three scopes `WorkspaceConfiguration.inspect` reports. */
interface Scoped {
  defaultValue?: boolean | string
  globalValue?: boolean | string
  workspaceValue?: boolean | string
}

/** Stubs the `testMyCode` configuration; `get` answers the user scope, as VS Code does. */
function stubConfiguration(sections: Record<string, Scoped>): void {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: (section: string, fallback?: unknown) =>
      sections[section]?.globalValue ?? sections[section]?.defaultValue ?? fallback,
    inspect: (section: string) => sections[section],
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
      logLevel: { defaultValue: LogLevel.Errors, globalValue: LogLevel.Verbose },
      hideMetaFiles: { defaultValue: true, globalValue: true, workspaceValue: false },
      downloadOldSubmission: { defaultValue: false, globalValue: false, workspaceValue: true },
      updateExercisesAutomatically: {
        defaultValue: true,
        globalValue: true,
        workspaceValue: false,
      },
      javaHome: {
        defaultValue: "",
        globalValue: "/user/java",
        workspaceValue: "/usr/lib/jvm/java-21",
      },
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

  test("each workspace-scoped setting notifies its own subscriber with the new value", async function () {
    const notified: [string, boolean][] = []
    settings.onChangeHideMetaFiles = (value): void => void notified.push(["hideMetaFiles", value])
    settings.onChangeDownloadOldSubmission = (value): void =>
      void notified.push(["downloadOldSubmission", value])
    settings.onChangeUpdateExercisesAutomatically = (value): void =>
      void notified.push(["updateExercisesAutomatically", value])

    await changeSection("testMyCode.hideMetaFiles")
    await changeSection("testMyCode.downloadOldSubmission")
    await changeSection("testMyCode.updateExercisesAutomatically")

    expect(notified).toEqual([
      ["hideMetaFiles", false],
      ["downloadOldSubmission", true],
      ["updateExercisesAutomatically", false],
    ])
  })

  // The workspace file keeps its own copy, which would otherwise shadow the User tab for as
  // long as the course workspace is open.
  test("a User-tab edit reaches the subscriber over a stale workspace copy", async function () {
    const notified: boolean[] = []
    settings.onChangeDownloadOldSubmission = (value): void => void notified.push(value)
    stubConfiguration({
      downloadOldSubmission: { defaultValue: false, globalValue: true, workspaceValue: true },
    })
    await changeSection("testMyCode.downloadOldSubmission")
    stubConfiguration({
      downloadOldSubmission: { defaultValue: false, globalValue: false, workspaceValue: true },
    })
    await changeSection("testMyCode.downloadOldSubmission")

    expect(notified).toEqual([true, false])
  })

  test("a workspace edit leaves the User value alone", async function () {
    const notified: boolean[] = []
    settings.onChangeDownloadOldSubmission = (value): void => void notified.push(value)
    stubConfiguration({
      downloadOldSubmission: { defaultValue: false, globalValue: false, workspaceValue: false },
    })
    await changeSection("testMyCode.downloadOldSubmission")

    expect(notified).toEqual([false])
  })

  test("a User edit made before anyone subscribed is not mistaken for a later one", async function () {
    stubConfiguration({
      downloadOldSubmission: { defaultValue: false, globalValue: true, workspaceValue: true },
    })
    await changeSection("testMyCode.downloadOldSubmission")
    const notified: boolean[] = []
    settings.onChangeDownloadOldSubmission = (value): void => void notified.push(value)
    stubConfiguration({
      downloadOldSubmission: { defaultValue: false, globalValue: true, workspaceValue: false },
    })
    await changeSection("testMyCode.downloadOldSubmission")

    expect(notified).toEqual([false])
  })

  test("a setting the workspace has no copy of reads the User value", function () {
    stubConfiguration({ updateExercisesAutomatically: { defaultValue: true, globalValue: false } })

    expect(settings.getAutomaticallyUpdateExercises()).toBe(false)
  })

  test("a change to an unrelated section notifies nobody", async function () {
    const configure = vi.spyOn(Logger, "configure").mockImplementation(() => {})
    const notified: string[] = []
    settings.onChangeHideMetaFiles = (): void => void notified.push("hideMetaFiles")
    settings.onChangeDownloadOldSubmission = (): void => void notified.push("downloadOldSubmission")

    await changeSection("editor.fontSize")

    expect(configure).not.toHaveBeenCalled()
    expect(notified).toEqual([])
  })

  test("the workspace scope wins over the user scope for a workspace setting", function () {
    expect(settings.getDownloadOldSubmission()).toBe(true)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(false)
  })

  // Machine-overridable, unlike the booleans: a JDK path belongs to the machine, and the
  // course workspace file must not pin one.
  test("the Java home is the effective value, trimmed", function () {
    stubConfiguration({ javaHome: { defaultValue: "", globalValue: " /usr/lib/jvm/java-21 " } })

    expect(settings.getJavaHome()).toBe("/usr/lib/jvm/java-21")
  })

  test("a setting the workspace does not override falls back to its default", function () {
    // A multi-root workspace reports no workspace value when it matches the
    // default, so the default has to stand in rather than read as `false`.
    stubConfiguration({
      downloadOldSubmission: { defaultValue: true },
      updateExercisesAutomatically: { defaultValue: false, workspaceValue: true },
    })

    expect(settings.getDownloadOldSubmission()).toBe(true)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(true)
  })

  test("the log level comes from the user scope", function () {
    expect(settings.getLogLevel()).toBe(LogLevel.Verbose)
  })

  test("disposing stops the configuration listener", function () {
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.results.at(-1)
      ?.value as vscode.Disposable
    const dispose = vi.spyOn(listener, "dispose")
    settings.dispose()

    expect(dispose).toHaveBeenCalled()
  })
})
