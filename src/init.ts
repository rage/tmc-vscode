import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import TemplateEngine from "./ui/templateEngine";
import UI from "./ui/ui";

import { Err, Ok, Result, Results } from "ts-results";
import Resources from "./config/resources";
import Storage from "./config/storage";
import { AuthenticationError } from "./errors";
import { displayCourseDetails, displayCourses, displayOrganizations, displaySummary, doLogout } from "./ui/treeview/actions";
import { downloadFile, openFolder } from "./utils";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 *
 * TODO: split up into reasonable pieces as functionality expands
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(
    extensionContext: vscode.ExtensionContext, ui: UI,
    storage: Storage, tmc: TMC, resources: Resources) {
    // Register handlebars helper function to resolve full logo paths
    // or switch to an existing placeholder image.

    ui.treeDP.registerVisibilityGroup("loggedIn", tmc.isAuthenticated());
    ui.treeDP.registerVisibilityGroup("orgChosen", storage.getOrganizationSlug() !== undefined);
    ui.treeDP.registerVisibilityGroup("courseChosen", storage.getCourseId() !== undefined);

    // Register UI actions
    ui.treeDP.registerAction("Log out", ["loggedIn"], doLogout(ui, tmc));
    ui.treeDP.registerAction("Log in", ["!loggedIn"], async () => await ui.webview.setContentFromTemplate("login"));
    ui.treeDP.registerAction("Summary", ["loggedIn"], displaySummary(ui), "index");
    ui.treeDP.registerAction("Organization", ["loggedIn"], displayOrganizations(ui, tmc), "orgs");
    ui.treeDP.registerAction("Courses", ["orgChosen", "loggedIn"], displayCourses(ui, storage, tmc), "courses");
    ui.treeDP.registerAction("Course details", ["orgChosen", "courseChosen", "loggedIn"],
        displayCourseDetails(ui, storage, tmc), "courseDetails");

    // Receives a login information from the webview, attempts to log in
    // If successful, show the logout command instead of the login one, and a temporary webview page
    ui.webview.registerHandler("login", async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.ok) {
            console.log("Logged in successfully");
            ui.treeDP.updateVisibility(["loggedIn"]);
            storage.getOrganizationSlug() === undefined ? ui.treeDP.triggerCallback("orgs") : ui.treeDP.triggerCallback("index");
        } else {
            console.log("Login failed: " + result.val.message);
            if (result.val instanceof AuthenticationError) {
                console.log("auth error");
            }
            ui.webview.setContentFromTemplate("login", { error: result.val.message });
        }
    });

    // Receives the slug of a selected organization from the webview, stores the value
    ui.webview.registerHandler("setOrganization", (msg: { type: string, slug: string }) => {
        console.log("Organization selected:", msg.slug);
        storage.updateOrganizationSlug(msg.slug);
        ui.treeDP.updateVisibility(["orgChosen"]);
        ui.treeDP.triggerCallback("courses");
    });

    // Receives the id of selected course from the webview, stores the value
    ui.webview.registerHandler("setCourse", (msg: { type: string, id: number }) => {
        console.log("Course selected:", msg.id);
        storage.updateCourseId(msg.id);
        ui.treeDP.updateVisibility(["courseChosen"]);
        ui.treeDP.triggerCallback("courseDetails");
    });

    // Receives the id of selected exercise from the webview, downloads and opens
    ui.webview.registerHandler("downloadExercises", async (msg: { type: string, ids: number[] }) => {
        ui.webview.setContentFromTemplate("loading");
        const results = Results(...await Promise.all(msg.ids.map((x) => tmc.downloadExercise(x))));
        if (results.ok) {
            console.log("opening downloaded exercises in: ", results.val);
            ui.webview.dispose();
            openFolder(...results.val.map((folderPath, index) =>
                ({ folderPath, name: msg.ids[index].toString() }))); // TODO: get proper exercise name from API
        } else {
            vscode.window.showErrorMessage("One or more exercise downloads failed.");
        }
    });
}

/**
 * Performs various actions required before the extension can be started for the first time
 *
 * @param extensionContext Extension context
 */
export async function firstTimeInitialization(extensionContext: vscode.ExtensionContext):
    Promise<Result<Resources, Error>> {

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");

    const basePath = extensionContext.globalStoragePath;
    const tmcDataPath = path.join(basePath, "tmcdata");
    const tmcLangsPath = path.join(tmcDataPath, "tmc-langs.jar");

    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath);
        console.log("Created global storage directory at", basePath);
    }

    if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath);
        console.log("Created tmc data directory at", tmcDataPath);
    }

    if (!fs.existsSync(tmcLangsPath)) {
        const result = await downloadFile("https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.7.16-SNAPSHOT.jar",
            tmcLangsPath);
        if (result.err) {
            return new Err(result.val);
        }
        console.log("tmc-langs.jar downloaded");
    }

    return new Ok(new Resources(
        cssPath,
        htmlPath,
        tmcDataPath,
        tmcLangsPath,
    ));
}
