import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { askForItem, showError } from "../window";

export async function addNewCourse(actionContext: ActionContext): Promise<void> {
    const { tmc } = actionContext;
    const organizations = await tmc.getOrganizations();
    if (organizations.err) {
        const message = "Failed to fetch organizations.";
        showError(message);
        Logger.error(message, organizations.val);
        return;
    }
    const chosenOrg = await askForItem<string>(
        "Which organization?",
        false,
        ...organizations.val.map<[string, string]>((org) => [org.name, org.slug]),
    );
    if (chosenOrg === undefined) {
        return;
    }

    const courses = await tmc.getCourses(chosenOrg);
    if (courses.err) {
        const message = `Failed to fetch organization courses for ${chosenOrg}`;
        showError(message);
        Logger.error(message, courses.val);
        return;
    }
    const chosenCourse = await askForItem<number>(
        "Which course?",
        false,
        ...courses.val.map<[string, number]>((course) => [course.title, course.id]),
    );
    if (chosenCourse === undefined) {
        return;
    }

    const result = await actions.addNewCourse(actionContext, {
        organization: chosenOrg,
        course: chosenCourse,
    });
    if (result.err) {
        const message = "Failed to add course via menu.";
        showError(message);
        Logger.error(message, result.val);
    }
}
