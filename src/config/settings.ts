import * as vscode from "vscode"

import { Logger, LogLevel } from "../utilities/logger"

/**
 * The settings a course workspace file keeps its own copy of (`WorkspaceManager`'s integrity
 * pass writes them), because a multi-root workspace reads them from there.
 */
export type MirroredSetting =
  | "hideMetaFiles"
  | "downloadOldSubmission"
  | "updateExercisesAutomatically"

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
  private _onChangeMirroredSetting?: (section: MirroredSetting, value: boolean) => void

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

        // `_changedValue` runs even with no callback yet: it tracks the User value, and
        // activation writes settings before the callbacks are registered.
        for (const section of MIRRORED_SETTINGS) {
          if (event.affectsConfiguration(`testMyCode.${section}`)) {
            const value = this._changedValue(section)
            this._onChangeMirroredSetting?.(section, value)
          }
        }
      }),
    ]
  }

  /** Called with a mirrored setting's new value whenever the user changes it. */
  // oxlint-disable-next-line accessor-pairs -- write-only callback registration API
  public set onChangeMirroredSetting(callback: (section: MirroredSetting, value: boolean) => void) {
    this._onChangeMirroredSetting = callback
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
