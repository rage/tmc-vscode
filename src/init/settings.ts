import type { ReadyActionContext } from "../actions/types"

export function registerSettingsCallbacks(actionContext: ReadyActionContext): void {
  const { settings } = actionContext
  const { workspaceManager } = actionContext.startup

  settings.onChangeHideMetaFiles = async (hide): Promise<void> => {
    await workspaceManager.excludeMetaFilesInWorkspace(hide)
  }
}
