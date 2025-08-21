import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";
import { LocalCourseData } from "../shared/shared";

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
        ...courses.map<[string, LocalCourseData]>((c) => {
            const name = LocalCourseData.getCourseName(c);
            return [name === currentWorkspace ? `${name} (Currently open)` : name, c];
        }),
    );
    if (courseWorkspace) {
        actions.openWorkspace(actionContext, LocalCourseData.getCourseName(courseWorkspace));
    }
}
