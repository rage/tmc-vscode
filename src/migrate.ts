import * as fs from "fs-extra";
import * as path from "path";

import { ActionContext } from "./actions/types";
import { Logger } from "./utils";
import { showError } from "./window";

/**
 * Migration plan to move all exercise folders from "closed-exercises" to their opened location.
 * i.e. tmcdata/TMC Workspace/Exercises/organizationSlug/courseName/exerciseName
 * hy/hy-data-analysis-with-python-2020/part01-e01_hello_world
 * From v0.10.0 to v2.0.0
 * @param actionContext
 */
export async function newVSCodeWorkspaceMigration(actionContext: ActionContext): Promise<void> {
    const { workspaceManager, resources } = actionContext;
    const allExerciseData = workspaceManager.getAllExercises();
    const oldTMCWorkspace = path.join(
        resources.getWorkspaceFolderPath(),
        "TMC Exercises.code-workspace",
    );
    const closedPath = path.join(resources.getDataPath(), "closed-exercises");
    if (fs.existsSync(oldTMCWorkspace)) {
        fs.removeSync(oldTMCWorkspace);
    }
    if (fs.existsSync(closedPath) && fs.readdirSync(closedPath).length !== 0) {
        allExerciseData?.forEach(async (ex) => {
            const closedPath = path.join(
                resources.getDataPath(),
                "closed-exercises",
                ex.id.toString(),
            );
            const openPath = path.join(
                resources.getExercisesFolderPath(),
                ex.organization,
                ex.course,
                ex.name,
            );
            if (fs.existsSync(closedPath)) {
                const ok = await workspaceManager.moveFolder(closedPath, openPath);
                if (ok.err) {
                    const message = "Error while moving folders.";
                    Logger.error(message, ok.val);
                    showError(message);
                }
            }
        });
    } else {
        fs.removeSync(closedPath);
    }
}
