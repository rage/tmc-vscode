import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { LocalCourseData } from "../config/types";
import { askForItem } from "../window";

export async function switchWorkspace(actionContext: ActionContext): Promise<void> {
    const { userData } = actionContext;
    const courses = userData.getCourses();
    const currentWorkspace = vscode.workspace.name?.split(" ")[0];
    const courseWorkspace = await askForItem(
        "Select a course workspace to open",
        false,
        ...courses.map<[string, LocalCourseData]>((c) => [
            c.name === currentWorkspace ? `${c.name} (Currently open)` : c.name,
            c,
        ]),
    );
    if (courseWorkspace) {
        actions.openWorkspace(actionContext, courseWorkspace.name);
    }
}
