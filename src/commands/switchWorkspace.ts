import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { v2 as storage } from "../storage/data";
import { Logger } from "../utilities";

export async function switchWorkspace(actionContext: ActionContext): Promise<void> {
    const { dialog, userData } = actionContext;
    Logger.info("Switching workspace");
    if (userData.err) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const courses = userData.val.getCourses();
    const currentWorkspace = vscode.workspace.name?.split(" ")[0];
    const courseWorkspace = await dialog.selectItem(
        "Select a course workspace to open",
        ...courses.map<[string, storage.LocalCourseData]>((c) => [
            c.name === currentWorkspace ? `${c.name} (Currently open)` : c.name,
            c,
        ]),
    );
    if (courseWorkspace) {
        actions.openWorkspace(actionContext, courseWorkspace.name);
    }
}
