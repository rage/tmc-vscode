import { vi } from "vitest"
import * as vscode from "vscode"

import AiRestriction, { isActiveCourseAiAllowed, isAiAllowed } from "../../api/aiRestriction"
import { AI_OFF_SETTINGS } from "../../config/constants"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { LocalCourseData } from "../../shared/shared"
import { Logger } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"

const AI_SECTIONS = Object.keys(AI_OFF_SETTINGS)

/** A course workspace file as `AiRestriction` sees it, with every write recorded. */
class FakeCourseWorkspace {
  public activeCourse: string | undefined = "python-course"
  public readonly stored = new Map<string, unknown>()
  public readonly rejected = new Set<string>()
  public onWrite: (section: string) => void = () => {}
  public readonly replaceWorkspaceSetting = vi.fn(async (section: string, value: unknown) => {
    if (this.rejected.has(section)) {
      throw new Error(`Unable to write ${section}`)
    }
    if (value === undefined) {
      this.stored.delete(section)
    } else {
      this.stored.set(section, value)
    }
    this.onWrite(section)
  })

  public getStoredWorkspaceSetting(section: string): unknown {
    return this.stored.get(section)
  }

  public writtenSections(): string[] {
    return this.replaceWorkspaceSetting.mock.calls.map(([section]) => section)
  }
}

/** Declares `sections` the way installed extensions would; the rest are unknown to VS Code. */
function declare(sections: string[]): void {
  const declared = new Set(sections)
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    inspect: (section: string) => (declared.has(section) ? { defaultValue: null } : undefined),
  } as unknown as vscode.WorkspaceConfiguration)
}

function changeListener(): (event: vscode.ConfigurationChangeEvent) => void {
  return vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0] as never
}

function changeOf(section: string): vscode.ConfigurationChangeEvent {
  return { affectsConfiguration: (asked: string) => asked === section }
}

suite("AI restriction", function () {
  let workspace: FakeCourseWorkspace
  let ownership: vscode.Memento
  let isAllowed: boolean
  let restriction: AiRestriction

  function createRestriction(onDidChangeCourses?: vscode.Event<unknown>): AiRestriction {
    return new AiRestriction(workspace, ownership, () => isAllowed, onDidChangeCourses)
  }

  beforeEach(function () {
    workspace = new FakeCourseWorkspace()
    ownership = createMockMemento()
    isAllowed = false
    declare(AI_SECTIONS)
    vi.spyOn(Logger, "info").mockImplementation(() => undefined)
    vi.spyOn(Logger, "debug").mockImplementation(() => undefined)
    restriction = createRestriction()
  })

  afterEach(function () {
    restriction.dispose()
    vi.restoreAllMocks()
  })

  suite("when the course does not allow AI", function () {
    test("writes every setting, the one that restarts the extension host last", async function () {
      await restriction.apply()

      expect(Object.fromEntries(workspace.stored)).toEqual(AI_OFF_SETTINGS)
      expect(workspace.writtenSections().at(-1)).toBe("chat.disableAIFeatures")
    })

    test("writes nothing when the workspace file already holds the settings", async function () {
      for (const [section, value] of Object.entries(AI_OFF_SETTINGS)) {
        workspace.stored.set(section, value)
      }

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
    })

    test("writes only the setting that drifted", async function () {
      for (const [section, value] of Object.entries(AI_OFF_SETTINGS)) {
        workspace.stored.set(section, value)
      }
      workspace.stored.set("chat.disableAIFeatures", false)

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).toHaveBeenCalledExactlyOnceWith(
        "chat.disableAIFeatures",
        true,
      )
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

      expect(workspace.writtenSections().filter((s) => s.startsWith("codeium."))).toEqual([])
      expect(workspace.stored.get("chat.disableAIFeatures")).toBe(true)
    })

    test("a rejected write neither stops the others nor rejects", async function () {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
      workspace.rejected.add("chat.mcp.access")

      await expect(restriction.apply()).resolves.toBeUndefined()

      expect(workspace.stored.has("chat.mcp.access")).toBe(false)
      expect(workspace.stored.get("chat.disableAIFeatures")).toBe(true)
      expect(warn).toHaveBeenCalledOnce()
    })

    test("touches nothing outside a course workspace", async function () {
      workspace.activeCourse = undefined

      await restriction.apply()

      expect(workspace.replaceWorkspaceSetting).not.toHaveBeenCalled()
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

    test("gives up on a setting something keeps flipping back, and says so once", async function () {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
      const listener = changeListener()
      workspace.onWrite = (section): void => {
        if (section === "chat.disableAIFeatures") {
          workspace.stored.set(section, false)
          listener(changeOf(section))
        }
      }

      await restriction.apply()

      expect(
        workspace.writtenSections().filter((s) => s === "chat.disableAIFeatures"),
      ).toHaveLength(10)
      expect(warn).toHaveBeenCalledOnce()
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
