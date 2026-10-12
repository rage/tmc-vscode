import type { ReadyActionContext } from "../actions/types"

export function registerSettingsCallbacks(actionContext: ReadyActionContext): void {
  const { settings } = actionContext
  const { workspaceManager } = actionContext.startup

  settings.onChangeMirroredSetting = async (section, value): Promise<void> => {
    await workspaceManager.updateWorkspaceSetting(`testMyCode.${section}`, value)
    if (section === "hideMetaFiles") {
      await workspaceManager.excludeMetaFilesInWorkspace(value)
    }
  }
}
