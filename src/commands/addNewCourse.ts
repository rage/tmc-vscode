import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

export async function addNewCourse(actionContext: ActionContext): Promise<void> {
    const { dialog, tmc } = actionContext;
    Logger.info("Adding new course");

    const organizationsResult = await tmc.getOrganizations();
    if (organizationsResult.err) {
        dialog.errorNotification("Failed to fetch organizations.", organizationsResult.val);
        return;
    }

    const chosenOrg = await dialog.selectItem(
        "Which organization?",
        ...organizationsResult.val.map<[string, string]>((org) => [org.name, org.slug]),
    );
    if (chosenOrg === undefined) {
        return;
    }

    const courses = await tmc.getCourses(chosenOrg);
    if (courses.err) {
        dialog.errorNotification(`Failed to fetch organization courses for ${chosenOrg}.`);
        return;
    }
    const chosenCourse = await dialog.selectItem<number>(
        "Which course?",
        ...courses.val.map<[string, number]>((course) => [course.title, course.id]),
    );
    if (chosenCourse === undefined) {
        return;
    }

    const result = await actions.addNewCourse(actionContext, chosenOrg, chosenCourse);
    if (result.err) {
        dialog.errorNotification("Failed to add course.", result.val);
    }
}
