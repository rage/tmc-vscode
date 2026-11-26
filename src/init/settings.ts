import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { TmcPanel } from "../panels/TmcPanel"

export function registerSettingsCallbacks(actionContext: ReadyActionContext): void {
  const { settings } = actionContext
  const { workspaceManager } = actionContext.startup

  settings.onChangeHideMetaFiles = async (hide): Promise<void> => {
    await workspaceManager.excludeMetaFilesInWorkspace(hide)
  }
  applyContextKey(settings.isCoursesMoocFiEnabled())
  settings.onChangeCoursesMoocFiEnabled = (isEnabled): void => {
    applyContextKey(isEnabled)
    TmcPanel.reloadAddCourse()
  }
}

function applyContextKey(isEnabled: boolean): void {
  void vscode.commands.executeCommand("setContext", "test-my-code:CoursesMoocFi", isEnabled)
}
