import * as vscode from "vscode"

import type Storage from "../storage"
import { Logger, LogLevel } from "../utilities/logger"

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

  // Unused: kept only until the remaining call site stops passing a Storage.
  public constructor(_storage?: Storage) {
    this._disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("testMyCode.logLevel")) {
          const value = vscode.workspace
            .getConfiguration("testMyCode")
            .get<LogLevel>("logLevel", LogLevel.Errors)
          Logger.configure(value)
        }

        // Workspace settings
        if (event.affectsConfiguration("testMyCode.hideMetaFiles")) {
          const value = this._getWorkspaceSettingValue("hideMetaFiles")
          this._onChangeHideMetaFiles?.(value)
        }
        if (event.affectsConfiguration("testMyCode.downloadOldSubmission")) {
          const value = this._getWorkspaceSettingValue("downloadOldSubmission")
          this._onChangeDownloadOldSubmission?.(value)
        }
        if (event.affectsConfiguration("testMyCode.updateExercisesAutomatically")) {
          const value = this._getWorkspaceSettingValue("updateExercisesAutomatically")
          this._onChangeUpdateExercisesAutomatically?.(value)
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

  public isInsider(): boolean {
    return vscode.workspace.getConfiguration("testMyCode").get<boolean>("insiderVersion", false)
  }

  public async configureIsInsider(value: boolean): Promise<void> {
    await vscode.workspace.getConfiguration("testMyCode").update("insiderVersion", value, true)
  }

  public getJavaHome(): string {
    return this._getWorkspaceSettingString("javaHome")
  }

  /**
   * Used to fetch boolean values from VSCode settings API Workspace scope
   *
   * workspaceValue is undefined in multi-root workspace if it matches defaultValue
   * We want to "force" the value in the multi-root workspace, because then
   * the workspace scope > user scope.
   */
  private _getWorkspaceSettingValue(section: string): boolean {
    const configuration = vscode.workspace.getConfiguration("testMyCode")
    const scopeSettings = configuration.inspect<boolean>(section)
    if (scopeSettings?.workspaceValue === undefined) {
      return !!scopeSettings?.defaultValue
    }
    return scopeSettings.workspaceValue
  }

  /**
   * Used to fetch string values from VSCode settings API Workspace scope
   *
   * workspaceValue is undefined in multi-root workspace if it matches defaultValue
   * We want to "force" the value in the multi-root workspace, because then
   * the workspace scope > user scope.
   */
  private _getWorkspaceSettingString(section: string): string {
    const configuration = vscode.workspace.getConfiguration("testMyCode")
    const scopeSettings = configuration.inspect<string>(section)
    if (scopeSettings?.workspaceValue === undefined) {
      return scopeSettings?.defaultValue ?? ""
    }
    return scopeSettings.workspaceValue
  }
}
