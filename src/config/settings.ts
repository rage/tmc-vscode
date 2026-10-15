import * as vscode from "vscode"

import { Logger, LogLevel } from "../utilities/logger"

/**
 * Reads the extension's settings, and follows the changes the rest of the extension must
 * act on.
 *
 * Every read is VS Code's effective value, so a course workspace never shadows what the
 * student sets in their User settings unless they set it for the workspace themselves.
 */
export default class Settings implements vscode.Disposable {
  private _onChangeHideMetaFiles?: (hide: boolean) => void

  private _disposables: vscode.Disposable[]

  public constructor() {
    this._disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("testMyCode.logLevel")) {
          Logger.configure(this.getLogLevel())
        }
        if (event.affectsConfiguration("testMyCode.hideMetaFiles")) {
          this._onChangeHideMetaFiles?.(this.getHideMetaFiles())
        }
      }),
    ]
  }

  /** Called with `testMyCode.hideMetaFiles`'s new value whenever it changes. */
  // oxlint-disable-next-line accessor-pairs -- write-only callback registration API
  public set onChangeHideMetaFiles(callback: (hide: boolean) => void) {
    this._onChangeHideMetaFiles = callback
  }

  public dispose(): void {
    this._disposables.forEach((x) => x.dispose())
  }

  public getLogLevel(): LogLevel {
    return Settings._configuration().get<LogLevel>("logLevel", LogLevel.Errors)
  }

  public getHideMetaFiles(): boolean {
    return Settings._configuration().get<boolean>("hideMetaFiles", true)
  }

  public getDownloadOldSubmission(): boolean {
    return Settings._configuration().get<boolean>("downloadOldSubmission", true)
  }

  public getAutomaticallyUpdateExercises(): boolean {
    return Settings._configuration().get<boolean>("updateExercisesAutomatically", true)
  }

  /** The JDK directory Java exercises run with, or `""` for the one on `PATH`. */
  public getJavaHome(): string {
    return Settings._configuration().get<string>("javaHome", "").trim()
  }

  private static _configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("testMyCode")
  }
}
