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
import { downloadFileWithProgress } from "./utils";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(ui: UI, storage: Storage, tmc: TMC) {
    // Action callback ids
    const INDEX_ID = "index";
    const ORGANIZATIONS_ID = "orgs";
    const COURSES_ID = "courses";
    const COURSE_DETAILS_ID = "courseDetails";

    // Visibility groups
    const LOGGED_IN = "loggedIn";
    const NOT_LOGGED_IN = "!loggedIn";
    const ORGANIZATION_CHOSEN = "orgChosen";
    const COURSE_CHOSEN = "courseChosen";

    // Register visibility groups
    ui.treeDP.registerVisibilityGroup(LOGGED_IN, tmc.isAuthenticated());
    ui.treeDP.registerVisibilityGroup(ORGANIZATION_CHOSEN, storage.getOrganizationSlug() !== undefined);
    ui.treeDP.registerVisibilityGroup(COURSE_CHOSEN, storage.getCourseId() !== undefined);

    // Register UI actions
    const actionContext = { tmc, storage, ui };
    ui.treeDP.registerAction("Log out", [LOGGED_IN], doLogout(actionContext, [NOT_LOGGED_IN]));
    ui.treeDP.registerAction("Log in", [NOT_LOGGED_IN], async () => await ui.webview.setContentFromTemplate("login"));
    ui.treeDP.registerAction("Summary", [LOGGED_IN], displaySummary(actionContext), INDEX_ID);
    ui.treeDP.registerAction("Organization", [LOGGED_IN], displayOrganizations(actionContext), ORGANIZATIONS_ID);
    ui.treeDP.registerAction("Courses", [LOGGED_IN, ORGANIZATION_CHOSEN], displayCourses(actionContext), COURSES_ID);
    ui.treeDP.registerAction("Course details", [LOGGED_IN, ORGANIZATION_CHOSEN, COURSE_CHOSEN],
        displayCourseDetails(actionContext), COURSE_DETAILS_ID);

    // Register webview handlers
    const handlerContext = { tmc, storage, ui };
    ui.webview.registerHandler("setOrganization", setOrganization(handlerContext, [ORGANIZATION_CHOSEN], COURSES_ID));
    ui.webview.registerHandler("setCourse", setCourse(handlerContext, [COURSE_CHOSEN], COURSE_DETAILS_ID));
    ui.webview.registerHandler("login", handleLogin(handlerContext, [LOGGED_IN], ORGANIZATIONS_ID, INDEX_ID));
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
    const mediaPath = extensionContext.asAbsolutePath("media");

    const basePath = extensionContext.globalStoragePath;
    const tmcDataPath = path.join(basePath, "tmcdata");
    const tmcWorkspacePath = path.join(tmcDataPath, "TMC workspace");
    const tmcWorkspaceFilePath = path.join(tmcWorkspacePath, "TMC Exercises.code-workspace");
    const tmcExercisesFolderPath = path.join(tmcWorkspacePath, "Exercises");

    const tmcLangsPath = path.join(tmcDataPath, "tmc-langs.jar");

    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath);
        console.log("Created global storage directory at", basePath);
    }

    if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath);
        console.log("Created tmc data directory at", tmcDataPath);
    }

    if (!fs.existsSync(tmcWorkspacePath)) {
        fs.mkdirSync(tmcWorkspacePath);
        console.log("Created tmc workspace directory at", tmcWorkspacePath);
    }

    if (!fs.existsSync(tmcWorkspaceFilePath)) {
        fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify({ folders: [{ path: "Exercises" }] }));
        console.log("Created tmc workspace file at", tmcWorkspaceFilePath);
    }

    if (!fs.existsSync(tmcExercisesFolderPath)) {
        fs.mkdirSync(tmcExercisesFolderPath);
        console.log("Created tmc exercise directory at", tmcExercisesFolderPath);
    }

    if (!fs.existsSync(tmcLangsPath)) {
        const result = await downloadFileWithProgress("https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.7.16-SNAPSHOT.jar", tmcLangsPath,
                                                    "Welcome", "Downloading important components for the Test My Code plugin... 0 %");
        if (result.err) {
            return new Err(result.val);
        }
        console.log("tmc-langs.jar downloaded");
    }

    const resources: Resources = new Resources(
        cssPath,
        htmlPath,
        tmcDataPath,
        tmcLangsPath,
        tmcWorkspacePath,
        tmcWorkspaceFilePath,
        tmcExercisesFolderPath,
        mediaPath,
    );

    return new Ok(resources);
}
