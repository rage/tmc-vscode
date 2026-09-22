import type { ReadyActionContext } from "../actions/types"

export function registerSettingsCallbacks(actionContext: ReadyActionContext): void {
  const { settings } = actionContext
  const { workspaceManager } = actionContext.startup

  settings.onChangeHideMetaFiles = async (value: boolean): Promise<void> => {
    await workspaceManager.updateWorkspaceSetting("testMyCode.hideMetaFiles", value)
    await workspaceManager.excludeMetaFilesInWorkspace(value)
  }
  settings.onChangeDownloadOldSubmission = async (value: boolean): Promise<void> => {
    await workspaceManager.updateWorkspaceSetting("testMyCode.downloadOldSubmission", value)
  }
  settings.onChangeUpdateExercisesAutomatically = async (value: boolean): Promise<void> => {
    await workspaceManager.updateWorkspaceSetting("testMyCode.updateExercisesAutomatically", value)
  }
}
