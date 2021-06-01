import { ActionContext } from "../actions/types";
import * as commands from "../commands";

export async function registerSettingsCallbacks(actionContext: ActionContext): Promise<void> {
    const { settings, workspaceManager } = actionContext;
    settings.onChangeHideMetaFiles = async (value: boolean): Promise<void> => {
        await workspaceManager.updateWorkspaceSetting("testMyCode.hideMetaFiles", value);
        await workspaceManager.excludeMetaFilesInWorkspace(value);
    };
    settings.onChangeDownloadOldSubmission = async (value: boolean): Promise<void> => {
        await workspaceManager.updateWorkspaceSetting("testMyCode.downloadOldSubmission", value);
    };
    settings.onChangeUpdateExercisesAutomatically = async (value: boolean): Promise<void> => {
        await workspaceManager.updateWorkspaceSetting(
            "testMyCode.updateExercisesAutomatically",
            value,
        );
    };
    settings.onChangeTmcDataPath = async (): Promise<void> => {
        await commands.changeTmcDataPath(actionContext);
    };
}
