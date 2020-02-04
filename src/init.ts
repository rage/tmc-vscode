import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import UI from "./ui/ui";

import { Err, Ok, Result } from "ts-results";
import Resources from "./config/resources";
import Storage from "./config/storage";
import { displayCourseDetails, displayCourses, displayOrganizations, displaySummary, doLogout } from "./ui/treeview/actions";
import { downloadExercises, handleLogin, setCourse, setOrganization } from "./ui/treeview/handlers";
import { downloadFile } from "./utils";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(ui: UI, storage: Storage, tmc: TMC) {
    const LOGGED_IN = ui.treeDP.createVisibilityGroup(tmc.isAuthenticated());
    const ORGANIZATION_CHOSEN = ui.treeDP.createVisibilityGroup(storage.getOrganizationSlug() !== undefined);
    const COURSE_CHOSEN = ui.treeDP.createVisibilityGroup(storage.getCourseId() !== undefined);

    const visibilityGroups = {
        COURSE_CHOSEN, LOGGED_IN, ORGANIZATION_CHOSEN,
    };

    // Register UI actions
    const actionContext = { tmc, storage, ui, visibilityGroups };
    ui.treeDP.registerAction("Log out", [LOGGED_IN], doLogout(actionContext));
    ui.treeDP.registerAction("Log in", [LOGGED_IN.not], async () => await ui.webview.setContentFromTemplate("login"));
    ui.treeDP.registerAction("Summary", [LOGGED_IN], displaySummary(actionContext), "index");
    ui.treeDP.registerAction("Organization", [LOGGED_IN], displayOrganizations(actionContext), "orgs");
    ui.treeDP.registerAction("Courses", [LOGGED_IN, ORGANIZATION_CHOSEN], displayCourses(actionContext), "courses");
    ui.treeDP.registerAction("Course details", [LOGGED_IN, ORGANIZATION_CHOSEN, COURSE_CHOSEN],
        displayCourseDetails(actionContext), "courseDetails");

    // Register webview handlers
    const handlerContext = { tmc, storage, ui, visibilityGroups };
    ui.webview.registerHandler("setOrganization", setOrganization(handlerContext));
    ui.webview.registerHandler("setCourse", setCourse(handlerContext));
    ui.webview.registerHandler("login", handleLogin(handlerContext));
    ui.webview.registerHandler("downloadExercises", downloadExercises(handlerContext));
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
