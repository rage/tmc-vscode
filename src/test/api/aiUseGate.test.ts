import { vi } from "vitest"
import * as vscode from "vscode"

import * as aiRestriction from "../../api/aiRestriction"
import type { AiRestrictionLapse } from "../../api/aiRestriction"
import { AiUseGate, enabledAiExtensions } from "../../api/aiUseGate"
import { AiUseRefusedError, presentationFor, SHOW_AI_USE_PROBLEM_COMMAND } from "../../errors"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeMoocKind } from "../../shared/shared"
import { Logger } from "../../utilities"

const COURSE = makeMoocKind({
  id: "instance-1",
  name: "python-course",
}) as unknown as LocalCourseData
const EXERCISE_FOLDER = vscode.Uri.file("/tmc/projects/python-course/loops")
const WORKSPACE_FILE = vscode.Uri.file("/tmc/workspaces/python-course.code-workspace")

const vscodeModule = vscode as unknown as { extensions: typeof vscode.extensions }

function withEnabledExtensions(ids: string[]): void {
  Object.defineProperty(vscodeModule, "extensions", {
    value: { all: ids.map((id) => ({ id })) },
    configurable: true,
  })
}

function gateWith(lapse: AiRestrictionLapse | undefined): {
  gate: AiUseGate
  enforce: ReturnType<typeof vi.fn>
} {
  const enforce = vi.fn(async () => lapse)
  return { gate: new AiUseGate({ enforce }), enforce }
}

async function refusalOf(gate: AiUseGate): Promise<AiUseRefusedError | undefined> {
  return gate.refusal(COURSE, EXERCISE_FOLDER)
}

beforeEach(function () {
  withEnabledExtensions([])
  vi.spyOn(Logger, "info").mockImplementation(() => undefined)
  vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
})

afterEach(function () {
  vi.restoreAllMocks()
})

suite("enabledAiExtensions", function () {
  test("finds the listed AI extensions this window runs, ignoring the case of their ids", function () {
    withEnabledExtensions(["ms-python.python", "saoudrizwan.claude-dev", "continue.continue"])

    expect(enabledAiExtensions()).toEqual([
      { id: "Continue.continue", name: "Continue" },
      { id: "saoudrizwan.claude-dev", name: "Cline" },
    ])
  })

  test("finds nothing when no listed extension runs", function () {
    withEnabledExtensions(["ms-python.python", "GitHub.copilot-chat"])

    expect(enabledAiExtensions()).toEqual([])
  })
})

suite("AiUseGate", function () {
  test("a course that allows AI goes ahead without checking anything", async function () {
    vi.spyOn(aiRestriction, "isAiAllowed").mockReturnValue(true)
    withEnabledExtensions(["saoudrizwan.claude-dev"])
    const { gate, enforce } = gateWith({ kind: "outsideCourseWorkspace" })

    await expect(refusalOf(gate)).resolves.toBeUndefined()

    expect(enforce).not.toHaveBeenCalled()
  })

  test("goes ahead while the restriction is in force and no AI extension runs", async function () {
    const { gate, enforce } = gateWith(undefined)

    await expect(refusalOf(gate)).resolves.toBeUndefined()

    expect(enforce).toHaveBeenCalledExactlyOnceWith(EXERCISE_FOLDER)
  })

  test("names every enabled AI extension and shows the first one in the Extensions view", async function () {
    withEnabledExtensions(["saoudrizwan.claude-dev", "anthropic.claude-code"])
    const { gate } = gateWith(undefined)

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toBe(
      "AI assistance must be off in this course. Disable Claude Code and Cline for this" +
        " workspace (Extensions → Disable (Workspace)) and try again.",
    )
    expect(refusal?.remedyLabel).toBe("Show Claude Code")
    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.extensions.search",
      "@id:anthropic.claude-code",
    )
  })

  test("outside a course workspace, offers to open the course's", async function () {
    const gate = new AiUseGate(undefined)

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toContain("Open the exercise in the course workspace")
    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "tmc.openCourseWorkspace",
      CourseIdentifier.from("instance-1"),
    )
  })

  test("an unsaved workspace file is named, and opened", async function () {
    const showTextDocument = vi
      .spyOn(vscode.window, "showTextDocument")
      .mockResolvedValue(undefined as never)
    const { gate } = gateWith({
      kind: "workspaceFileUnwritable",
      file: WORKSPACE_FILE,
      problem: "unsaved",
      reason: "Unable to write into workspace settings because the file has unsaved changes.",
    })

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toBe(
      "AI settings in the course workspace couldn't be applied: save or revert the changes to" +
        " python-course.code-workspace and try again.",
    )
    expect(refusal?.remedyLabel).toBe("Open python-course.code-workspace")
    expect(showTextDocument).toHaveBeenCalledExactlyOnceWith(WORKSPACE_FILE)
  })

  test("a read-only workspace file is named, and revealed", async function () {
    const { gate } = gateWith({
      kind: "workspaceFileUnwritable",
      file: WORKSPACE_FILE,
      problem: "readOnly",
      reason: "EACCES",
    })

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toBe(
      "AI settings in the course workspace couldn't be applied: python-course.code-workspace" +
        " is read-only. Make it writable and try again.",
    )
    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "revealFileInOS",
      WORKSPACE_FILE,
    )
  })

  test("any other refused write gives VS Code's own reason", async function () {
    const { gate } = gateWith({
      kind: "workspaceFileUnwritable",
      file: WORKSPACE_FILE,
      problem: undefined,
      reason:
        "Unable to write into the workspace configuration file. Please open the file to correct errors/warnings in it and try again.",
    })

    const refusal = await refusalOf(gate)

    expect(refusal?.message).toBe(
      "AI settings in the course workspace couldn't be applied: Unable to write into the" +
        " workspace configuration file. Please open the file to correct errors/warnings in it" +
        " and try again.",
    )
  })

  test("a User setting that wins names the setting and opens the User settings", async function () {
    const { gate } = gateWith({
      kind: "settingOverridden",
      section: "editor.inlineSuggest.enabled",
      languageId: "python",
      source: { kind: "user" },
    })

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toBe(
      "AI assistance must be off in this course, but your User settings turn" +
        " editor.inlineSuggest.enabled for python back on. Remove it from your User settings" +
        " and try again.",
    )
    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.openSettingsJson",
    )
  })

  test("an exercise folder setting that wins names its file and opens it", async function () {
    const showTextDocument = vi
      .spyOn(vscode.window, "showTextDocument")
      .mockResolvedValue(undefined as never)
    const { gate } = gateWith({
      kind: "settingOverridden",
      section: "editor.inlineSuggest.enabled",
      languageId: undefined,
      source: { kind: "folder", folder: EXERCISE_FOLDER },
    })

    const refusal = await refusalOf(gate)
    await gate.showProblem()

    expect(refusal?.message).toBe(
      "AI assistance must be off in this course, but loops/.vscode/settings.json turns" +
        " editor.inlineSuggest.enabled back on. Remove it from that file and try again.",
    )
    expect(showTextDocument).toHaveBeenCalledExactlyOnceWith(
      vscode.Uri.joinPath(EXERCISE_FOLDER, ".vscode", "settings.json"),
    )
  })

  test("the restriction lapsing comes before an enabled extension", async function () {
    withEnabledExtensions(["saoudrizwan.claude-dev"])
    const gate = new AiUseGate(undefined)

    const refusal = await refusalOf(gate)

    expect(refusal?.message).not.toContain("Cline")
  })

  test("shows nothing once the latest check went ahead", async function () {
    withEnabledExtensions(["saoudrizwan.claude-dev"])
    const { gate } = gateWith(undefined)
    await refusalOf(gate)
    withEnabledExtensions([])
    await refusalOf(gate)

    await gate.showProblem()

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })
})

suite("a refusal's presentation", function () {
  test("is its own sentence and its one remedy", function () {
    const refusal = new AiUseRefusedError("AI assistance must be off.", "Show Cline")

    expect(presentationFor(refusal)).toEqual({
      message: "AI assistance must be off.",
      actions: [{ label: "Show Cline", command: SHOW_AI_USE_PROBLEM_COMMAND }],
    })
  })

  test("has no button without a remedy", function () {
    expect(presentationFor(new AiUseRefusedError("AI assistance must be off.")).actions).toEqual([])
  })
})
