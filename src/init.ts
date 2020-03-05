import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import UI from "./ui/ui";

import { Err, Ok, Result } from "ts-results";
import {
    closeCompletedExercises, closeExercises, displayCourseDownloadDetails, displayLocalExerciseDetails, displaySummary,
    downloadExercises, login, logout, openExercises, openUncompletedExercises, selectNewCourse,
} from "./actions/actions";
import WorkspaceManager from "./api/workspaceManager";
import Resources from "./config/resources";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { downloadFileWithProgress } from "./utils";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(
    ui: UI, storage: Storage, tmc: TMC, workspaceManager: WorkspaceManager, resources: Resources, userData: UserData,
) {
    const LOGGED_IN = ui.treeDP.createVisibilityGroup(tmc.isAuthenticated());
    const ORGANIZATION_CHOSEN = ui.treeDP.createVisibilityGroup(storage.getOrganizationSlug() !== undefined);
    const COURSE_CHOSEN = ui.treeDP.createVisibilityGroup(storage.getCourseId() !== undefined);

    const visibilityGroups = {
        COURSE_CHOSEN, LOGGED_IN, ORGANIZATION_CHOSEN,
    };

    // UI Action IDs
    const LOGIN_ACTION = "login";
    const INDEX_ACTION = "index";

    // Register UI actions
    const actionContext = { tmc, workspaceManager, ui, resources, userData };
    ui.treeDP.registerAction("Log out", [LOGGED_IN],
        () => { logout(visibilityGroups, actionContext); });
    ui.treeDP.registerAction("Log in", [LOGGED_IN.not],
        async () => await ui.webview.setContentFromTemplate(LOGIN_ACTION));
    ui.treeDP.registerAction("My courses", [LOGGED_IN],
        () => { displaySummary(actionContext); }, INDEX_ACTION);

    // Register webview handlers
    ui.webview.registerHandler("login", ({ username, password }) => {
        login(actionContext, username, password, visibilityGroups);
    });
    ui.webview.registerHandler("downloadExercises",
        (msg: { type: "downloadExercises", ids: number[], courseName: string,
                organizationSlug: string, courseId: number }) => {
                    downloadExercises(actionContext, msg.ids, msg.organizationSlug, msg.courseName, msg.courseId);
    });
    ui.webview.registerHandler("addCourse", () => {
        selectNewCourse(actionContext);
    });
    ui.webview.registerHandler("exerciseDownloads", (msg: { type: string, id: number }) => {
        displayCourseDownloadDetails(msg.id, actionContext);
    });
    ui.webview.registerHandler("exerciseDetails", (msg: { type: string, id: number }) => {
        displayLocalExerciseDetails(msg.id, actionContext);
    });
    ui.webview.registerHandler("openSelected", async (msg: { type: "openSelected", ids: number[], id: number }) => {
        actionContext.ui.webview.setContentFromTemplate("loading");
        await openExercises(msg.ids, actionContext);
        displayLocalExerciseDetails(msg.id, actionContext);
    });
    ui.webview.registerHandler("closeSelected", async (msg: { type: "closeSelected", ids: number[], id: number }) => {
        actionContext.ui.webview.setContentFromTemplate("loading");
        await closeExercises(msg.ids, actionContext);
        displayLocalExerciseDetails(msg.id, actionContext);
    });
    ui.webview.registerHandler("openUncompleted", async (msg: { type: "openUncompleted", id: number }) => {
        actionContext.ui.webview.setContentFromTemplate("loading");
        await openUncompletedExercises(msg.id, actionContext);
        displayLocalExerciseDetails(msg.id, actionContext);
    });
    ui.webview.registerHandler("closeCompleted", async (msg: { type: "closeCompleted", id: number }) => {
        actionContext.ui.webview.setContentFromTemplate("loading");
        await closeCompletedExercises(msg.id, actionContext);
        displayLocalExerciseDetails(msg.id, actionContext);
    });
}

/**
 * Performs various actions required before the extension can be started for the first time
 *
 * @param extensionContext Extension context
 */
export async function firstTimeInitialization(extensionContext: vscode.ExtensionContext):
    Promise<Result<Resources, Error>> {
    const extensionVersion = vscode.extensions.getExtension("tmc-vscode-temporary.tmc-vscode")?.packageJSON.version;

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");
    const mediaPath = extensionContext.asAbsolutePath("media");

    const basePath = extensionContext.globalStoragePath;
    const tmcDataPath = path.join(basePath, "tmcdata");
    const tmcWorkspacePath = path.join(tmcDataPath, "TMC workspace");
    const tmcWorkspaceFilePath = path.join(tmcWorkspacePath, "TMC Exercises.code-workspace");
    const tmcExercisesFolderPath = path.join(tmcWorkspacePath, "Exercises");
    const tmcClosedExercisesFolderPath = path.join(tmcDataPath, "closed-exercises");

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

    if (!fs.existsSync(tmcClosedExercisesFolderPath)) {
        fs.mkdirSync(tmcClosedExercisesFolderPath);
        console.log("Created tmc closed exercise directory at", tmcClosedExercisesFolderPath);
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
        extensionVersion,
        htmlPath,
        tmcDataPath,
        tmcLangsPath,
        tmcWorkspacePath,
        tmcWorkspaceFilePath,
        tmcExercisesFolderPath,
        tmcClosedExercisesFolderPath,
        mediaPath,
    );

    return new Ok(resources);
}
