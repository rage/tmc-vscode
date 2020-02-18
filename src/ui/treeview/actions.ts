import { Err } from "ts-results";

import TMC from "../../api/tmc";
import Storage from "../../config/storage";
import UI from "../ui";
import { ActionContext } from "./types";

/**
 * Returns an action that fetches all courses of the current organization and displays them in webview when called.
 * @param ui UI instance used for setting up the webview
 * @param storage Storage instance used for reading current organization
 * @param tmc TMC API instance used for fetching courses
 */
export function displayCourses({ tmc, storage, ui }: ActionContext) {
    return async () => {
        const result = await tmc.getCourses();
        const slug = storage.getOrganizationSlug();

        if (slug === undefined) {
            return;
        }
        const resultOrg = await tmc.getOrganization(slug);

        if (result.ok) {
            console.log("Courses loaded");
            const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
            const organization = resultOrg.val;
            const data = { courses, organization };
            await ui.webview.setContentFromTemplate("course", data);
        } else {
            console.log("Fetching courses failed: " + result.val.message);
        }
    };
}

/**
 * Returns an action that fetches all organizations and displays them in webview when called.
 * @param ui UI instance used for setting up the webview
 * @param tmc TMC API instance used for fetching organizations
 */
export function displayOrganizations({ tmc, ui }: ActionContext) {
    return async () => {
        const result = await tmc.getOrganizations();
        if (result.ok) {
            console.log("Organizations loaded");
            const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
            const pinned = organizations.filter((organization) => organization.pinned);
            const data = { organizations, pinned };
            await ui.webview.setContentFromTemplate("organization", data);
        } else {
            console.log("Fetching organizations failed: " + result.val.message);
        }
    };
}

/**
 * Returns an action that displays the summary page in webview when called.
 * @param ui UI instance used for setting the webview
 */
export function displaySummary({ ui }: ActionContext) {
    // TODO: Have something to display on summary.
    return async () => await ui.webview.setContentFromTemplate("index");
}
