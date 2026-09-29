import * as vscode from "vscode"

import { Logger, LogLevel } from "../utilities/logger"

/**
 * The settings a course workspace file keeps its own copy of (`WorkspaceManager`'s integrity
 * pass writes them), because a multi-root workspace reads them from there.
 */
type MirroredSetting = "hideMetaFiles" | "downloadOldSubmission" | "updateExercisesAutomatically"

const MIRRORED_SETTINGS: MirroredSetting[] = [
  "hideMetaFiles",
  "downloadOldSubmission",
  "updateExercisesAutomatically",
]

/**
 * Class to manage VSCode setting changes and trigger events based on changes.
 *
 * Handle multi-root workspace changes by creating callbacks in extension.ts,
 * so that we can test and don't need workspaceManager dependency.
 */
export default class Settings implements vscode.Disposable {
  private _onChangeHideMetaFiles?: (value: boolean) => void
  private _onChangeDownloadOldSubmission?: (value: boolean) => void
  private _onChangeUpdateExercisesAutomatically?: (value: boolean) => void

  private _disposables: vscode.Disposable[]
  /** Each mirrored setting's User-scope value as last seen, to tell which scope changed. */
  private readonly _userValues = new Map<MirroredSetting, boolean | undefined>()

  public constructor() {
    for (const section of MIRRORED_SETTINGS) {
      this._userValues.set(section, Settings._inspect(section)?.globalValue)
    }
    this._disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("testMyCode.logLevel")) {
          const value = vscode.workspace
            .getConfiguration("testMyCode")
            .get<LogLevel>("logLevel", LogLevel.Errors)
          Logger.configure(value)
        }

        if (event.affectsConfiguration("testMyCode.hideMetaFiles")) {
          this._onChangeHideMetaFiles?.(this._changedValue("hideMetaFiles"))
        }
        if (event.affectsConfiguration("testMyCode.downloadOldSubmission")) {
          this._onChangeDownloadOldSubmission?.(this._changedValue("downloadOldSubmission"))
        }
        if (event.affectsConfiguration("testMyCode.updateExercisesAutomatically")) {
          this._onChangeUpdateExercisesAutomatically?.(
            this._changedValue("updateExercisesAutomatically"),
          )
        }
      }),
    ]
  }

  // oxlint-disable-next-line accessor-pairs -- write-only callback registration API
  public set onChangeDownloadOldSubmission(callback: (value: boolean) => void) {
    this._onChangeDownloadOldSubmission = callback
  }

  // oxlint-disable-next-line accessor-pairs -- write-only callback registration API
  public set onChangeHideMetaFiles(callback: (value: boolean) => void) {
    this._onChangeHideMetaFiles = callback
  }

  // oxlint-disable-next-line accessor-pairs -- write-only callback registration API
  public set onChangeUpdateExercisesAutomatically(callback: (value: boolean) => void) {
    this._onChangeUpdateExercisesAutomatically = callback
  }

  public dispose(): void {
    this._disposables.forEach((x) => x.dispose())
  }

  public getLogLevel(): LogLevel {
    return vscode.workspace
      .getConfiguration("testMyCode")
      .get<LogLevel>("logLevel", LogLevel.Errors)
  }

  public getDownloadOldSubmission(): boolean {
    return this._getWorkspaceSettingValue("downloadOldSubmission")
  }

  public getAutomaticallyUpdateExercises(): boolean {
    return this._getWorkspaceSettingValue("updateExercisesAutomatically")
  }

  /** The JDK directory Java exercises run with, or `""` for the one on `PATH`. */
  public getJavaHome(): string {
    return vscode.workspace.getConfiguration("testMyCode").get<string>("javaHome", "").trim()
  }

  /** A mirrored setting's value: the workspace copy, else the User value, else the default. */
  private _getWorkspaceSettingValue(section: MirroredSetting): boolean {
    const scopes = Settings._inspect(section)
    return !!(scopes?.workspaceValue ?? scopes?.globalValue ?? scopes?.defaultValue)
  }

  /**
   * The value a mirrored setting has just changed to. An edit in the User tab wins over the
   * workspace copy, which would otherwise shadow it for as long as that course is open.
   */
  private _changedValue(section: MirroredSetting): boolean {
    const userValue = Settings._inspect(section)?.globalValue
    const isUserEdit = userValue !== this._userValues.get(section)
    this._userValues.set(section, userValue)
    return isUserEdit && userValue !== undefined
      ? userValue
      : this._getWorkspaceSettingValue(section)
  }

  private static _inspect(
    section: MirroredSetting,
  ): { defaultValue?: boolean; globalValue?: boolean; workspaceValue?: boolean } | undefined {
    return vscode.workspace.getConfiguration("testMyCode").inspect<boolean>(section)
  }
}
