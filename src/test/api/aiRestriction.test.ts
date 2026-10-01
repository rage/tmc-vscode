import * as _ from "lodash"
import { vi } from "vitest"
import * as vscode from "vscode"

import AiRestriction, { isActiveCourseAiAllowed, isAiAllowed } from "../../api/aiRestriction"
import type { AiRestrictionEvents } from "../../api/aiRestriction"
import type { SettingInspection, WorkspaceFileProblem } from "../../api/workspaceManager"
import { AI_OFF_SETTINGS } from "../../config/constants"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { LocalCourseData } from "../../shared/shared"
import { Logger } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"

const AI_SECTIONS = Object.keys(AI_OFF_SETTINGS)
const INLINE_SUGGEST = "editor.inlineSuggest.enabled"
const WORKSPACE_FILE = vscode.Uri.file("/tmc/workspaces/python-course.code-workspace")
const EXERCISE_FOLDER = vscode.Uri.file("/tmc/projects/python-course/loops")

function keyOf(section: string, languageId?: string): string {
  return languageId === undefined ? section : `[${languageId}]${section}`
}

/**
 * A course workspace as `AiRestriction` sees it, with every write recorded. Each scope maps
 * `section`, or `[languageId]section` for a language override, to its value.
 */
class FakeCourseWorkspace {
  public activeCourse: string | undefined = "python-course"
  public workspaceFileUri: vscode.Uri | undefined = WORKSPACE_FILE
  /** The workspace file. */
  public readonly stored = new Map<string, unknown>()
  public readonly user = new Map<string, unknown>()
  /** The exercise folder's `.vscode/settings.json`, which counts only for a resource inside it. */
  public readonly folder = new Map<string, unknown>()
  public readonly defaults = new Map<string, unknown>([[INLINE_SUGGEST, true]])
  /** Keys whose writes VS Code refuses. */
  public readonly rejected = new Set<string>()
  public problem: WorkspaceFileProblem | undefined
  public onWrite: (section: string, languageId: string | undefined) => void = () => {}
  public readonly replaceWorkspaceSetting = vi.fn(
    async (section: string, value: unknown, languageId?: string) => {
      const key = keyOf(section, languageId)
      if (this.rejected.has(key)) {
        throw new Error("Unable to write into the workspace configuration file.")
      }
      if (value === undefined) {
        this.stored.delete(key)
      } else {
        this.stored.set(key, value)
      }
      this.onWrite(section, languageId)
    },
  )

  public readonly workspaceFileProblem = vi.fn(async () => this.problem)

  public getStoredWorkspaceSetting(section: string, languageId?: string): unknown {
    return this.stored.get(keyOf(section, languageId))
  }

  /** Resolves like VS Code: a language override at any scope beats every scope's plain value. */
  public inspectSetting(
    section: string,
    languageId?: string,
    resource?: vscode.Uri,
  ): SettingInspection {
    const folder = resource ? this.folder : new Map<string, unknown>()
    const plain = [this.defaults, this.user, this.stored, folder].map((s) => s.get(section))
    const language =
      languageId === undefined
        ? []
        : [this.defaults, this.user, this.stored, folder].map((s) =>
            s.get(keyOf(section, languageId)),
          )
    const effectiveValue = [...plain, ...language].reduce<unknown>((winner, value) => {
      if (value === undefined) {
        return winner
      }
      return _.isPlainObject(winner) && _.isPlainObject(value)
        ? { ...(winner as object), ...(value as object) }
        : value
    }, undefined)
    const languageIds = [this.user, this.stored, this.folder].flatMap((scope) =>
      [...scope.keys()].flatMap((key) => {
        const match = /^\[(.+)\](.+)$/.exec(key)
        return match?.[2] === section ? [match[1] as string] : []
      }),
    )
    return {
      key: section,
      defaultValue: plain[0],
      globalValue: plain[1],
      workspaceValue: plain[2],
      workspaceFolderValue: plain[3],
      defaultLanguageValue: language[0],
      globalLanguageValue: language[1],
      workspaceLanguageValue: language[2],
      workspaceFolderLanguageValue: language[3],
      languageIds: _.uniq(languageIds),
      effectiveValue,
    }
  }

  public writtenKeys(): string[] {
    return this.replaceWorkspaceSetting.mock.calls.map(([section, , languageId]) =>
      keyOf(section, languageId),
    )
  }
}

/** Declares `sections` the way installed extensions would; the rest are unknown to VS Code. */
function declare(sections: string[]): void {
  const declared = new Set(sections)
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    inspect: (section: string) => (declared.has(section) ? { defaultValue: null } : undefined),
  } as unknown as vscode.WorkspaceConfiguration)
}

/** The events an `AiRestriction` listens to, fired by hand. */
class FakeEvents implements AiRestrictionEvents {
  public readonly configurationChanged = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
  public readonly documentOpened = new vscode.EventEmitter<vscode.TextDocument>()
  public readonly workspaceFileChanged = new vscode.EventEmitter<void>()
  public readonly onDidChangeConfiguration = this.configurationChanged.event
  public readonly onDidOpenTextDocument = this.documentOpened.event
  public readonly onDidChangeWorkspaceFile = this.workspaceFileChanged.event
}

let events: FakeEvents

function changeListener(): (event: vscode.ConfigurationChangeEvent) => void {
  return (event) => events.configurationChanged.fire(event)
}

function openListener(): (document: vscode.TextDocument) => void {
  return (document) => events.documentOpened.fire(document)
}

function changeOf(section: string): vscode.ConfigurationChangeEvent {
  return { affectsConfiguration: (asked: string) => asked === section }
}

function holdEverySetting(workspace: FakeCourseWorkspace): void {
  for (const [section, value] of Object.entries(AI_OFF_SETTINGS)) {
    workspace.stored.set(section, value)
  }
}

function withOpenDocuments(languageIds: string[]): void {
  const documents = languageIds.map((languageId) => ({ languageId }))
  vi.spyOn(vscode.workspace, "textDocuments", "get").mockReturnValue(
    documents as unknown as vscode.TextDocument[],
  )
}

suite("AI restriction", function () {
  let workspace: FakeCourseWorkspace
  let ownership: vscode.Memento
  let isAllowed: boolean
  let restriction: AiRestriction

  function createRestriction(onDidChangeCourses?: vscode.Event<unknown>): AiRestriction {
    return new AiRestriction(workspace, ownership, () => isAllowed, onDidChangeCourses, events)
  }

  beforeEach(function () {
    events = new FakeEvents()
    workspace = new FakeCourseWorkspace()
    ownership = createMockMemento()
    isAllowed = false
    declare(AI_SECTIONS)
    Object.defineProperty(vscode.workspace, "textDocuments", {
      get: () => [],
      configurable: true,
    })
    vi.spyOn(Logger, "info").mockImplementation(() => undefined)
    vi.spyOn(Logger, "debug").mockImplementation(() => undefined)
    vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
    restriction = createRestriction()
  })

  afterEach(function () {
    restriction.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  suite("when the course does not allow AI", function () {
    test("writes every setting, the one that restarts the extension host last", async function () {
      await restriction.apply()

      expect(Object.fromEntries(workspace.stored)).toEqual(AI_OFF_SETTINGS)
      expect(workspace.writtenKeys().at(-1)).toBe("chat.disableAIFeatures")
    })

    test("writes nothing when the workspace file already holds the settings", async function () {
      holdEverySetting(workspace)

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })

    test("writes only the setting that drifted", async function () {
      holdEverySetting(workspace)
      workspace.stored.set("chat.disableAIFeatures", false)

      await restriction.apply()

      expect(workspace.writtenKeys()).toEqual(["chat.disableAIFeatures"])
    })

    test("turns off each course language in a per-language map and keeps other entries", async function () {
      workspace.stored.set("github.copilot.enable", { python: true, rust: true })

      await restriction.apply()

      expect(workspace.stored.get("github.copilot.enable")).toEqual({
        ...(AI_OFF_SETTINGS["github.copilot.enable"] as object),
        rust: true,
      })
    })

    test("skips a setting no installed extension declares", async function () {
      declare(AI_SECTIONS.filter((section) => !section.startsWith("codeium.")))

      await restriction.apply()

      expect(workspace.writtenKeys().filter((s) => s.startsWith("codeium."))).toEqual([])
      expect(workspace.stored.get("chat.disableAIFeatures")).toBe(true)
    })

    test("a rejected write neither stops the others nor rejects", async function () {
      workspace.rejected.add("chat.mcp.access")

      await expect(restriction.apply()).resolves.toBeUndefined()

      expect(workspace.stored.has("chat.mcp.access")).toBe(false)
      expect(workspace.stored.get("chat.disableAIFeatures")).toBe(true)
    })

    test("touches nothing outside a course workspace", async function () {
      workspace.activeCourse = undefined

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })
  })

  suite("language overrides", function () {
    test("a user-scope language override is beaten by a workspace one of its own", async function () {
      holdEverySetting(workspace)
      workspace.user.set(keyOf(INLINE_SUGGEST, "python"), true)

      await restriction.apply()

      expect(workspace.writtenKeys()).toEqual([keyOf(INLINE_SUGGEST, "python")])
      expect(workspace.inspectSetting(INLINE_SUGGEST, "python").effectiveValue).toBe(false)
      await expect(restriction.enforce()).resolves.toBeUndefined()
    })

    test("a language outside the course languages is covered once something overrides it", async function () {
      holdEverySetting(workspace)
      workspace.user.set(keyOf(INLINE_SUGGEST, "haskell"), true)

      await restriction.apply()

      expect(workspace.stored.get(keyOf(INLINE_SUGGEST, "haskell"))).toBe(false)
    })

    test("covers the language of an open document", async function () {
      holdEverySetting(workspace)
      // A contributed language default, which no scope the student edits lists.
      workspace.defaults.set(keyOf(INLINE_SUGGEST, "ruby"), true)
      withOpenDocuments(["ruby"])

      await restriction.apply()

      expect(workspace.stored.get(keyOf(INLINE_SUGGEST, "ruby"))).toBe(false)
    })

    test("a document opening in a language not seen before starts a pass", async function () {
      holdEverySetting(workspace)
      await restriction.apply()
      workspace.defaults.set(keyOf(INLINE_SUGGEST, "ruby"), true)
      withOpenDocuments(["ruby"])

      openListener()({ languageId: "ruby" } as vscode.TextDocument)
      await restriction.apply()

      expect(workspace.stored.get(keyOf(INLINE_SUGGEST, "ruby"))).toBe(false)
    })

    test("writes no language block where the workspace file's own value already wins", async function () {
      await restriction.apply()

      expect(workspace.writtenKeys().filter((key) => key.startsWith("["))).toEqual([])
    })

    test("removes the language blocks it wrote once the course allows AI", async function () {
      workspace.user.set(keyOf(INLINE_SUGGEST, "python"), true)
      await restriction.apply()
      isAllowed = true

      await restriction.apply()

      expect(workspace.stored.size).toBe(0)
    })
  })

  suite("when the course allows AI", function () {
    test("removes the settings it wrote", async function () {
      await restriction.apply()
      isAllowed = true

      await restriction.apply()

      expect(workspace.stored.size).toBe(0)
    })

    test("leaves a setting it did not write", async function () {
      workspace.stored.set("editor.inlineSuggest.enabled", false)
      await restriction.apply()
      isAllowed = true

      await restriction.apply()

      expect([...workspace.stored.keys()]).toEqual(["editor.inlineSuggest.enabled"])
    })

    test("keeps the student's own entries of a per-language map", async function () {
      workspace.stored.set("github.copilot.enable", { rust: true })
      await restriction.apply()
      isAllowed = true

      await restriction.apply()

      expect(workspace.stored.get("github.copilot.enable")).toEqual({ rust: true })
    })

    test("keeps a value the student changed after it was written", async function () {
      await restriction.apply()
      workspace.stored.set("cody.suggestions.mode", "autocomplete")
      isAllowed = true

      await restriction.apply()

      expect(Object.fromEntries(workspace.stored)).toEqual({
        "cody.suggestions.mode": "autocomplete",
      })
    })

    test("writes nothing when it owns nothing", async function () {
      isAllowed = true

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })
  })

  suite("live re-apply", function () {
    test("puts back a setting the student turned on", async function () {
      await restriction.apply()
      workspace.stored.set("chat.disableAIFeatures", false)

      changeListener()(changeOf("chat.disableAIFeatures"))
      await restriction.apply()

      expect(workspace.stored.get("chat.disableAIFeatures")).toBe(true)
    })

    test("ignores a change to any other setting", async function () {
      changeListener()(changeOf("files.autoSave"))
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })

    test("its own writes end in a pass that writes nothing, not a loop", async function () {
      const listener = changeListener()
      workspace.onWrite = (section): void => listener(changeOf(section))

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).toHaveBeenCalledTimes(AI_SECTIONS.length)
    })

    test("a course data change re-decides", async function () {
      let notifyCoursesChanged: (() => void) | undefined
      restriction.dispose()
      restriction = createRestriction((listener) => {
        notifyCoursesChanged = listener as () => void
        return { dispose: () => undefined }
      })
      await restriction.apply()
      isAllowed = true

      notifyCoursesChanged?.()
      await restriction.apply()

      expect(workspace.stored.size).toBe(0)
    })
  })

  suite("passes", function () {
    test("a pass re-entered from its first read runs once more after it, not alongside", async function () {
      let writesInFlight = 0
      let mostWritesInFlight = 0
      workspace.replaceWorkspaceSetting.mockImplementation(async (section, value) => {
        writesInFlight++
        mostWritesInFlight = Math.max(mostWritesInFlight, writesInFlight)
        await new Promise((resolve) => {
          setTimeout(resolve, 0)
        })
        workspace.stored.set(section, value)
        writesInFlight--
      })
      let reentries = 0
      restriction.dispose()
      restriction = new AiRestriction(
        workspace,
        ownership,
        () => {
          if (reentries++ === 0) {
            void restriction.apply()
          }
          return isAllowed
        },
        undefined,
        events,
      )

      await restriction.apply()

      expect(mostWritesInFlight).toBe(1)
      expect(reentries).toBe(2)
      expect(Object.fromEntries(workspace.stored)).toEqual(AI_OFF_SETTINGS)
    })

    test("writes nothing once disposed", async function () {
      restriction.dispose()

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })

    test("a pass in progress stops before its next write once disposed", async function () {
      workspace.onWrite = (): void => restriction.dispose()

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).toHaveBeenCalledOnce()
    })
  })

  suite("refused writes", function () {
    const REFUSED = "chat.mcp.access"

    function attempts(): number {
      return workspace.writtenKeys().filter((key) => key === REFUSED).length
    }

    beforeEach(function () {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      workspace.rejected.add(REFUSED)
    })

    test("are retried on a timer, each wait twice as long as the last", async function () {
      await restriction.apply()
      expect(attempts()).toBe(1)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(attempts()).toBe(2)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(attempts()).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(attempts()).toBe(3)

      workspace.rejected.clear()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(workspace.stored.get(REFUSED)).toBe("none")
      expect(vi.getTimerCount()).toBe(0)
    })

    test("are retried as soon as the workspace file is saved or changed on disk", async function () {
      await restriction.apply()
      workspace.rejected.clear()

      events.workspaceFileChanged.fire()
      // Well before the timer's retry.
      await vi.advanceTimersByTimeAsync(1)

      expect(workspace.stored.get(REFUSED)).toBe("none")
    })
  })

  suite("backoff", function () {
    const FLAPPED = "chat.agent.enabled"

    /** Something that turns `FLAPPED` back on each time it is written, until stopped. */
    function flapUntilStopped(): () => void {
      let isFlapping = true
      const listener = changeListener()
      workspace.onWrite = (section): void => {
        if (isFlapping && section === FLAPPED) {
          workspace.stored.set(section, true)
          listener(changeOf(section))
        }
      }
      return () => {
        isFlapping = false
      }
    }

    beforeEach(function () {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      holdEverySetting(workspace)
    })

    test("leaves a setting that keeps flipping back alone after a few writes", async function () {
      flapUntilStopped()
      workspace.stored.set(FLAPPED, true)

      await restriction.apply()

      expect(workspace.writtenKeys().filter((key) => key === FLAPPED)).toHaveLength(5)
    })

    test("flapping one setting does not stop the others being put back", async function () {
      flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      await restriction.apply()

      workspace.stored.set("cody.suggestions.mode", "autocomplete")
      changeListener()(changeOf("cody.suggestions.mode"))
      await restriction.apply()

      expect(workspace.stored.get("cody.suggestions.mode")).toBe("off")
      expect(workspace.stored.get(FLAPPED)).toBe(true)
    })

    test("puts the setting back once its backoff ends, with nothing else changing", async function () {
      const stop = flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      await restriction.apply()
      stop()

      await vi.advanceTimersByTimeAsync(5_000)

      expect(workspace.stored.get(FLAPPED)).toBe(false)
    })

    test("each backoff of the same setting lasts twice as long", async function () {
      flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      await restriction.apply()
      await vi.advanceTimersByTimeAsync(5_000)
      const writesAfterFirstBackoff = workspace.writtenKeys().length

      await vi.advanceTimersByTimeAsync(5_000)
      expect(workspace.writtenKeys()).toHaveLength(writesAfterFirstBackoff)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(workspace.writtenKeys().length).toBeGreaterThan(writesAfterFirstBackoff)
    })

    test("schedules no retry once disposed", async function () {
      flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      // Disposed in the pass that backs the setting off.
      vi.mocked(Logger.warn).mockImplementation(() => restriction.dispose())

      await restriction.apply()

      expect(vi.getTimerCount()).toBe(0)
    })

    test("refused writes do not count toward it", async function () {
      workspace.stored.set(FLAPPED, true)
      workspace.rejected.add(FLAPPED)
      for (let i = 0; i < 2 * 5; i++) {
        await restriction.apply()
      }
      workspace.rejected.clear()

      await restriction.apply()

      expect(workspace.stored.get(FLAPPED)).toBe(false)
      expect(Logger.warn).toHaveBeenCalledWith(
        `Could not write ${FLAPPED} to turn off AI assistance.`,
        expect.any(Error),
      )
      expect(Logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("keeps turning"))
    })

    test("a write is on record before it is made, and taken back when refused", async function () {
      const recorded = (): number[] | undefined =>
        ownership.get<Record<string, { writeTimes: number[] }>>("aiOffSettingsBackoffs")?.[FLAPPED]
          ?.writeTimes
      const recordedDuringWrites: (number[] | undefined)[] = []
      workspace.onWrite = (): void => void recordedDuringWrites.push(recorded())
      workspace.stored.set(FLAPPED, true)
      workspace.rejected.add(FLAPPED)
      await restriction.apply()
      expect(recorded()).toEqual([])
      workspace.rejected.clear()

      await restriction.apply()

      expect(recordedDuringWrites).toEqual([[Date.now()]])
    })

    test("outlives the extension host", async function () {
      flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      await restriction.apply()
      restriction.dispose()
      workspace.replaceWorkspaceSetting.mockClear()

      restriction = createRestriction()
      await restriction.apply()

      expect(workspace.writtenKeys()).toEqual([])
    })

    test("writes no language block for a setting backed off at the top level", async function () {
      const listener = changeListener()
      workspace.onWrite = (section, languageId): void => {
        if (section === INLINE_SUGGEST && languageId === undefined) {
          workspace.stored.set(section, true)
          listener(changeOf(section))
        }
      }
      workspace.stored.set(INLINE_SUGGEST, true)
      workspace.user.set(keyOf(INLINE_SUGGEST, "haskell"), true)

      await restriction.apply()

      expect(workspace.writtenKeys().filter((key) => key.startsWith("["))).toEqual([])
    })

    test("enforce writes a backed-off setting anyway", async function () {
      const stop = flapUntilStopped()
      workspace.stored.set(FLAPPED, true)
      await restriction.apply()
      stop()

      await expect(restriction.enforce()).resolves.toBeUndefined()

      expect(workspace.stored.get(FLAPPED)).toBe(false)
    })
  })

  suite("enforce", function () {
    test("the restriction is in force once every setting holds", async function () {
      await expect(restriction.enforce()).resolves.toBeUndefined()
    })

    test.each<[string, WorkspaceFileProblem | undefined]>([
      ["has unsaved changes", "unsaved"],
      ["is read-only", "readOnly"],
      ["has a syntax error", undefined],
    ])(
      "is not in force while the workspace file %s and refuses writes",
      async function (_case, problem) {
        workspace.problem = problem
        workspace.rejected.add("chat.mcp.access")

        await expect(restriction.enforce()).resolves.toEqual({
          kind: "workspaceFileUnwritable",
          file: WORKSPACE_FILE,
          problem,
          reason: "Unable to write into the workspace configuration file.",
        })
      },
    )

    test("a write refused in the background still counts once nothing has changed", async function () {
      workspace.rejected.add("chat.mcp.access")
      await restriction.apply()

      workspace.rejected.clear()
      await expect(restriction.enforce()).resolves.toBeUndefined()

      expect(workspace.stored.get("chat.mcp.access")).toBe("none")
    })

    test("a refused top-level write is not also tried for every language", async function () {
      workspace.rejected.add(INLINE_SUGGEST)

      await restriction.enforce()

      expect(workspace.writtenKeys().filter((key) => key.startsWith("["))).toEqual([])
    })

    test("is not in force while the exercise folder's own settings turn a setting back on", async function () {
      workspace.folder.set(INLINE_SUGGEST, true)
      vi.spyOn(vscode.workspace, "getWorkspaceFolder").mockReturnValue({
        uri: EXERCISE_FOLDER,
        name: "loops",
        index: 1,
      })

      await expect(restriction.enforce(EXERCISE_FOLDER)).resolves.toEqual({
        kind: "settingOverridden",
        section: INLINE_SUGGEST,
        languageId: undefined,
        source: { kind: "folder", folder: EXERCISE_FOLDER },
      })
    })

    test("a value nothing the student set wins is not held against them", async function () {
      await restriction.apply()
      // e.g. a machine policy; no scope the student edits holds the value.
      vi.spyOn(workspace, "inspectSetting").mockImplementation((section) => ({
        key: section,
        effectiveValue: section === "chat.mcp.access" ? "all" : AI_OFF_SETTINGS[section],
      }))

      await expect(restriction.enforce()).resolves.toBeUndefined()
    })

    test("is not in force outside a course workspace", async function () {
      workspace.activeCourse = undefined

      await expect(restriction.enforce()).resolves.toEqual({ kind: "outsideCourseWorkspace" })
    })

    test("is not in force when the open course allows AI", async function () {
      isAllowed = true

      await expect(restriction.enforce()).resolves.toEqual({ kind: "outsideCourseWorkspace" })
    })
  })
})

suite("isAiAllowed", function () {
  const tmcCourse = makeTmcKind({ id: 1, name: "python-course" }) as unknown as LocalCourseData
  const moocCourse = makeMoocKind({ id: "c1", name: "python-course" }) as unknown as LocalCourseData

  test("no course is allowed AI: tmc, mooc or unknown", function () {
    expect([isAiAllowed(tmcCourse), isAiAllowed(moocCourse), isAiAllowed(undefined)]).toEqual([
      false,
      false,
      false,
    ])
  })

  test("the open course is not allowed AI without course data", function () {
    expect(
      isActiveCourseAiAllowed(
        { activeCourse: "python-course", activeCourseBackend: "mooc" },
        undefined,
      ),
    ).toBe(false)
  })
})
