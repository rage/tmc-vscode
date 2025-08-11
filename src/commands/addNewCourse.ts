import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Organization } from "../shared/langsSchema";
import { CourseIdentifier, Enum, makeMoocKind, makeTmcKind, match } from "../shared/shared";
import { Logger } from "../utilities";

export async function addNewCourse(actionContext: ActionContext): Promise<void> {
    const { dialog, langs } = actionContext;
    Logger.info("Adding new course");
    if (langs.err) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const tmcOrganizationsResult = await langs.val.getTmcOrganizations();
    const moocOrganizationsResult = await langs.val.getMoocOrganizations();
    if (tmcOrganizationsResult.err) {
        dialog.errorNotification("Failed to fetch organizations.", tmcOrganizationsResult.val);
        return;
    }
    if (moocOrganizationsResult.err) {
        dialog.errorNotification("Failed to fetch organizations.", moocOrganizationsResult.val);
        return;
    }

    const organizations: Array<Enum<Organization, Organization>> = [
        ...tmcOrganizationsResult.val.map(makeTmcKind),
        ...moocOrganizationsResult.val.map(makeMoocKind),
    ];
    const chosenOrg = await dialog.selectItem(
        "Which organization?",
        ...organizations.map<[string, Enum<Organization, Organization>]>((org) => [
            org.data.name,
            org,
        ]),
    );
    if (chosenOrg === undefined) {
        return;
    }

    const courses = await match(
        chosenOrg,
        (tmc) => langs.val.getCourses(tmc.slug),
        (mooc) => langs.val.getCourses(mooc.slug),
    );
    if (courses.err) {
        dialog.errorNotification(`Failed to fetch organization courses for ${chosenOrg}.`);
        return;
    }
    const chosenCourse = await dialog.selectItem<CourseIdentifier>(
        "Which course?",
        ...courses.val.map<[string, CourseIdentifier]>((course) => [
            course.title,
            makeTmcKind({ courseId: course.id }),
        ]),
    );
    if (chosenCourse === undefined) {
        return;
    }

    const result = await actions.addNewCourse(actionContext, chosenOrg.data.slug, chosenCourse);
    if (result.err) {
        dialog.errorNotification("Failed to add course.", result.val);
    }
}
