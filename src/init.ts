import * as fs from "fs";
import * as handlebars from "handlebars";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import UI from "./ui/ui";

import Storage from "./config/storage";
import { AuthenticationError } from "./errors";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 *
 * TODO: split up into reasonable pieces as functionality expands
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(extensionContext: vscode.ExtensionContext, ui: UI, storage: Storage, tmc: TMC) {
    // Register handlebars helper function to resolve full logo paths
    // or switch to an existing placeholder image.
    handlebars.registerHelper("resolve_logo_path", (logoPath: string) => {
        return (!logoPath.endsWith("missing.png"))
            ? `https://tmc.mooc.fi${logoPath}`
            : "https://tmc.mooc.fi/logos/small_logo/missing.png";
    });

    ui.treeDP.registerVisibilityGroup("loggedIn", tmc.isAuthenticated());
    ui.treeDP.registerVisibilityGroup("orgChosen", storage.getOrganizationSlug() !== undefined);

    // Logs out, closes the webview, hides the logout command, shows the login command
    ui.treeDP.registerAction("Log out", ["loggedIn"], () => {
        tmc.deauthenticate();
        ui.webview.dispose();
        ui.treeDP.updateVisibility(["!loggedIn"]);
    });

    // Displays the login webview
    ui.treeDP.registerAction("Log in", ["!loggedIn"], async () => {
        ui.webview.setContent(await getTemplate(extensionContext, "login"));
    });

    // Displays the organization webview
    ui.treeDP.registerAction("Organization", ["loggedIn"], async () => {
        const result = await tmc.getOrganizations();

        if (result.ok) {
            console.log("Organizations loaded");
            const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
            const pinned = organizations.filter((organization) => organization.pinned);
            const data = { organizations, pinned };
            ui.webview.setContent(await getTemplate(extensionContext, "organization", data));
        } else {
            console.log("Fetching organizations failed: " + result.val.message);
        }
    });

    // Displays the course webview
    ui.treeDP.registerAction("Courses", ["orgChosen", "loggedIn"], async () => {
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
            ui.webview.setContent(await getTemplate(extensionContext, "course", data));
        } else {
            console.log("Fetching courses failed: " + result.val.message);
        }
    });

    // Receives a login information from the webview, attempts to log in
    // If successful, show the logout command instead of the login one, and a temporary webview page
    ui.webview.registerHandler("login", async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.ok) {
            console.log("Logged in successfully");
            ui.treeDP.updateVisibility(["loggedIn"]);
            ui.webview.setContent("Logged in.");
        } else {
            console.log("Login failed: " + result.val.message);
            if (result.val instanceof AuthenticationError) {
                console.log("auth error");
            }
            ui.webview.setContent(await getTemplate(extensionContext, "login", { error: result.val.message }));
        }
    });

    // Receives the slug of a selected organization from the webview, stores the value
    ui.webview.registerHandler("setOrganization", (msg: { type: string, slug: string }) => {
        console.log("Organization selected:", msg.slug);
        storage.updateOrganizationSlug(msg.slug);
        ui.treeDP.updateVisibility(["orgChosen"]);
        courseView();
    });

    // Receives the id of selected course from the webview, stores the value
    ui.webview.registerHandler("setCourse", (msg: { type: string, id: string }) => {
        console.log("Course selected:", msg.id);
        storage.updateCourseId(msg.id);
    });

    // TODO: Call treeDP actions, than this can be removed.
    const courseView = async () => {
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
            ui.webview.setContent(await getTemplate(extensionContext, "course", data));
        } else {
            console.log("Fetching courses failed: " + result.val.message);
        }
    };
}

/**
 * Creates an HTML document from a template, with a default CSS applied
 *
 * @param extensionContext
 * @param name Name of the template file to user
 * @param data Must contain all the variables used in the template
 *
 * @returns The HTML document as a string
 */
async function getTemplate(extensionContext: vscode.ExtensionContext, name: string, data?: any): Promise<string> {

    const p = path.join(extensionContext.extensionPath, `resources/templates/${name}.html`);
    const template = handlebars.compile(fs.readFileSync(p, "utf8"));
    if (!data) {
        data = {};
    }
    data.cssPath = resolvePath(extensionContext, "resources/style.css");
    data.bootstrapPath = resolvePath(extensionContext, "resources/bootstrap.min.css");
    data.test = "login";

    return template(data);
}

/**
 * Creates an absolute path from a relative one for use in webviews
 *
 * @param extensionContext
 * @param relativePath Path to resolve
 *
 * @returns the absolute path
 */
function resolvePath(extensionContext: vscode.ExtensionContext, relativePath: string): string {
    return vscode.Uri.file(path.join(extensionContext.extensionPath, relativePath)).toString().replace("file:", "vscode-resource:");
}
