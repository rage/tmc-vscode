import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { LocalCourseData } from "../api/storage";
import { Logger } from "../utilities";

export async function switchWorkspace(actionContext: ActionContext): Promise<void> {
    const { dialog, userData } = actionContext;
    Logger.info("Switching workspace");

    const courses = userData.getCourses();
    const currentWorkspace = vscode.workspace.name?.split(" ")[0];
    const courseWorkspace = await dialog.selectItem(
        "Select a course workspace to open",
        ...courses.map<[string, LocalCourseData]>((c) => [
            c.name === currentWorkspace ? `${c.name} (Currently open)` : c.name,
            c,
        ]),
    );
    if (courseWorkspace) {
        actions.openWorkspace(actionContext, courseWorkspace.name);
    }
}
