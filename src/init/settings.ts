import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

export async function registerSettingsCallbacks(actionContext: ActionContext): Promise<void> {
    const { settings, workspaceManager } = actionContext;
    if (!workspaceManager.ok) {
        Logger.error("The extension was not initialized properly");
        return;
    }

    settings.onChangeHideMetaFiles = async (value: boolean): Promise<void> => {
        await workspaceManager.val.updateWorkspaceSetting("testMyCode.hideMetaFiles", value);
        await workspaceManager.val.excludeMetaFilesInWorkspace(value);
    };
    settings.onChangeDownloadOldSubmission = async (value: boolean): Promise<void> => {
        await workspaceManager.val.updateWorkspaceSetting(
            "testMyCode.downloadOldSubmission",
            value,
        );
    };
    settings.onChangeUpdateExercisesAutomatically = async (value: boolean): Promise<void> => {
        await workspaceManager.val.updateWorkspaceSetting(
            "testMyCode.updateExercisesAutomatically",
            value,
        );
    };
}
