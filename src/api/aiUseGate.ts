import * as path from "path"

import * as vscode from "vscode"

import { LocalCourseData } from "../../shared/lib"
import { AI_EXTENSIONS } from "../config/constants"
import { AiUseRefusedError } from "../errors"
import { Logger } from "../utilities"
import type AiRestriction from "./aiRestriction"
import type { AiRestrictionLapse, WorkspaceFileUnwritable } from "./aiRestriction"
import { isAiAllowed } from "./aiRestriction"
import type Dialog from "./dialog"
import type { NotificationButton } from "./dialog"
import type { WorkspaceFileProblem } from "./workspaceManager"

/** An AI extension from {@link AI_EXTENSIONS} that is enabled in this window. */
export interface EnabledAiExtension {
  id: string
  name: string
}

/**
 * The {@link AI_EXTENSIONS} this window's extension host runs, in the list's order. Blind to
 * other extension hosts, such as a remote one.
 */
export function enabledAiExtensions(): EnabledAiExtension[] {
  const enabled = new Set(vscode.extensions.all.map((extension) => extension.id.toLowerCase()))
  return Object.entries(AI_EXTENSIONS)
    .filter(([id]) => enabled.has(id.toLowerCase()))
    .map(([id, name]) => ({ id, name }))
}

/** A refusal, and what its button opens. */
interface Refusal {
  error: AiUseRefusedError
  showProblem?: () => Thenable<unknown>
}

/**
 * Decides whether an exercise may be submitted, tested or pasted: only while its course allows
 * AI, or while the AI restriction is in force and no {@link AI_EXTENSIONS} entry is enabled.
 */
export class AiUseGate {
  private _lastRefusal: Refusal | undefined

  /**
   * @param _restriction The open course workspace's; `undefined` outside one.
   * @param _appName The editor's `vscode.env.appName`.
   */
  public constructor(
    private readonly _restriction: Pick<AiRestriction, "enforce"> | undefined,
    private readonly _appName = "Visual Studio Code",
  ) {}

  /**
   * Why working on an exercise of `course` must be refused right now, or `undefined` when it
   * may go ahead. Puts back any AI setting that drifted first.
   *
   * @param exerciseUri The exercise folder, whose own settings count too.
   */
  public async refusal(
    course: LocalCourseData,
    exerciseUri: vscode.Uri,
  ): Promise<AiUseRefusedError | undefined> {
    if (isAiAllowed(course)) {
      return undefined
    }
    const editor = aiNativeEditorName(this._appName)
    if (editor) {
      const refusal = new AiUseRefusedError(
        `This course does not allow AI assistance, and ${editor} has AI built in that ` +
          "TestMyCode cannot switch off. Use Visual Studio Code or VSCodium for this course.",
      )
      this._lastRefusal = { error: refusal }
      return refusal
    }
    const lapse = this._restriction
      ? await this._restriction.enforce(exerciseUri)
      : { kind: "outsideCourseWorkspace" as const }
    const refusal = lapse ? refusalForLapse(lapse, course) : refusalForExtensions()
    this._lastRefusal = refusal
    if (refusal) {
      Logger.info("Refused to work on an exercise while AI may be on.", refusal.error.message)
    }
    return refusal?.error
  }

  /** Opens where the cause of the latest refusal can be fixed; nothing when there is none. */
  public async showProblem(): Promise<void> {
    await this._lastRefusal?.showProblem?.()
  }
}

/**
 * Editors built on VS Code whose own AI no setting turns off, by the name they report as
 * `vscode.env.appName`; `undefined` for any other editor.
 */
export function aiNativeEditorName(appName: string): string | undefined {
  return AI_NATIVE_EDITORS.find((name) => appName.toLowerCase().includes(name.toLowerCase()))
}

const AI_NATIVE_EDITORS = ["Cursor", "Windsurf", "Trae", "Kiro", "Void"]

function refusalForExtensions(): Refusal | undefined {
  const [first, ...rest] = enabledAiExtensions()
  if (!first) {
    return undefined
  }
  const names = listOf([first, ...rest].map((extension) => extension.name))
  return {
    error: new AiUseRefusedError(
      `AI assistance must be off in this course. Disable ${names} for this workspace` +
        " (Extensions → Disable (Workspace)) and try again.",
      `Show ${first.name}`,
    ),
    showProblem: () =>
      vscode.commands.executeCommand("workbench.extensions.search", `@id:${first.id}`),
  }
}

/** Tells the user that AI assistance stays on because VS Code refused the AI restriction's writes. */
export async function warnOfUnwritableWorkspaceFile(
  dialog: Pick<Dialog, "warningNotification">,
  lapse: WorkspaceFileUnwritable,
): Promise<void> {
  const { error, showProblem } = refusalForUnwritableFile(lapse)
  const buttons: NotificationButton[] =
    error.remedyLabel && showProblem ? [[error.remedyLabel, () => void showProblem()]] : []
  await dialog.warningNotification(error.message, ...buttons)
}

/** File problems fixed outside VS Code, so the refusal reveals the file. */
const HELD_FILE_SENTENCES: Partial<Record<WorkspaceFileProblem, (fileName: string) => string>> = {
  readOnly: (fileName: string) => `${fileName} is read-only. Make it writable and try again.`,
  inUse: (fileName: string) =>
    `another program, such as a sync app or antivirus, holds ${fileName}. Close it and try again.`,
  protected: (fileName: string) =>
    `this computer does not let VS Code change ${fileName}, as folder protection such as ` +
    "Windows Controlled Folder Access can. Allow VS Code and try again.",
}

function refusalForUnwritableFile(lapse: WorkspaceFileUnwritable): Refusal {
  const notApplied = "AI settings in the course workspace couldn't be applied"
  const fileName = path.basename(lapse.file.fsPath)
  const sentence = lapse.problem && HELD_FILE_SENTENCES[lapse.problem]
  if (sentence) {
    return {
      error: new AiUseRefusedError(`${notApplied}: ${sentence(fileName)}`, "Reveal File"),
      showProblem: () => vscode.commands.executeCommand("revealFileInOS", lapse.file),
    }
  }
  const message =
    lapse.problem === "unsaved"
      ? `${notApplied}: save or revert the changes to ${fileName} and try again.`
      : `${notApplied}: ${lapse.reason}`
  return {
    error: new AiUseRefusedError(message, `Open ${fileName}`),
    showProblem: () => vscode.window.showTextDocument(lapse.file),
  }
}

function refusalForLapse(lapse: AiRestrictionLapse, course: LocalCourseData): Refusal {
  switch (lapse.kind) {
    case "outsideCourseWorkspace":
      return {
        error: new AiUseRefusedError(
          `The exercises of ${LocalCourseData.getCourseTitle(course)} are tested and submitted` +
            " in its course workspace, which keeps AI assistance off. Open the course" +
            " workspace and try again.",
          "Open Course Workspace",
        ),
        showProblem: () =>
          vscode.commands.executeCommand(
            "tmc.openCourseWorkspace",
            LocalCourseData.getCourseId(course),
          ),
      }
    case "workspaceFileUnwritable":
      return refusalForUnwritableFile(lapse)
    case "settingOverridden": {
      const setting =
        lapse.languageId === undefined ? lapse.section : `${lapse.section} for ${lapse.languageId}`
      if (lapse.source.kind === "user") {
        return {
          error: new AiUseRefusedError(
            `AI assistance must be off in this course, but your User settings turn ${setting}` +
              " back on. Remove it from your User settings and try again.",
            "Open User Settings",
          ),
          showProblem: () => vscode.commands.executeCommand("workbench.action.openSettingsJson"),
        }
      }
      const settingsFile = vscode.Uri.joinPath(lapse.source.folder, ".vscode", "settings.json")
      const shownPath = `${path.basename(lapse.source.folder.fsPath)}/.vscode/settings.json`
      return {
        error: new AiUseRefusedError(
          `AI assistance must be off in this course, but ${shownPath} turns ${setting} back` +
            " on. Remove it from that file and try again.",
          "Open settings.json",
        ),
        showProblem: () => vscode.window.showTextDocument(settingsFile),
      }
    }
  }
}

/** "a", "a and b", "a, b and c". */
function listOf(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
