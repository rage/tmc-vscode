import * as path from "path"

import * as vscode from "vscode"

import { AI_EXTENSIONS } from "../config/constants"
import { AiUseRefusedError } from "../errors"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import type AiRestriction from "./aiRestriction"
import type { AiRestrictionLapse } from "./aiRestriction"
import { isAiAllowed } from "./aiRestriction"

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

  /** @param _restriction The open course workspace's; `undefined` outside one. */
  public constructor(private readonly _restriction: Pick<AiRestriction, "enforce"> | undefined) {}

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

function refusalForLapse(lapse: AiRestrictionLapse, course: LocalCourseData): Refusal {
  const notApplied = "AI settings in the course workspace couldn't be applied"
  switch (lapse.kind) {
    case "outsideCourseWorkspace":
      return {
        error: new AiUseRefusedError(
          "AI assistance must be off in this course, and only its course workspace turns it" +
            " off. Open the exercise in the course workspace and try again.",
          "Open Course Workspace",
        ),
        showProblem: () =>
          vscode.commands.executeCommand(
            "tmc.openCourseWorkspace",
            LocalCourseData.getCourseId(course),
          ),
      }
    case "workspaceFileUnwritable": {
      const fileName = path.basename(lapse.file.fsPath)
      if (lapse.problem === "readOnly") {
        return {
          error: new AiUseRefusedError(
            `${notApplied}: ${fileName} is read-only. Make it writable and try again.`,
            "Reveal File",
          ),
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
