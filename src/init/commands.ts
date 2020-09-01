import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import * as commands from "../commands";
import { activate, deactivate } from "../extension";
import { isCorrectWorkspaceOpen, Logger } from "../utils/";
import { askForConfirmation, askForItem, showError, showNotification } from "../window";

export function registerCommands(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): void {
    const { resources, settings, ui, userData, tmc } = actionContext;
    Logger.log("Registering TMC VSCode commands");

    context.subscriptions.push(
        vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),

        vscode.commands.registerCommand(
            "tmc.cleanExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.cleanExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand(
            "tmc.closeExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.closeExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand("tmc.downloadNewExercises", async () =>
            commands.downloadNewExercises(actionContext),
        ),

        vscode.commands.registerCommand(
            "tmc.downloadOldSubmission",
            async (resource: vscode.Uri | undefined) =>
                commands.downloadOldSubmission(actionContext, resource),
        ),

        vscode.commands.registerCommand("tmc.myCourses", async () => {
            actions.displayUserCourses(actionContext);
        }),

        vscode.commands.registerCommand("tmc.openSettings", async () => {
            actions.openSettings(actionContext);
        }),

        vscode.commands.registerCommand(
            "tmc.pasteExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.pasteExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand(
            "tmc.resetExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.resetExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand("tmc.selectAction", async () => {
            vscode.commands.executeCommand(
                "workbench.action.quickOpen",
                ">TestMyCode: ",
                "test-my-code:WorkspaceActive",
            );
        }),

        vscode.commands.registerCommand(
            "tmc.submitExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.submitExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand("tmc.switchWorkspace", async () =>
            commands.switchWorkspace(actionContext),
        ),

        vscode.commands.registerCommand(
            "tmc.testExercise",
            async (resource: vscode.Uri | undefined) =>
                commands.testExercise(actionContext, resource),
        ),

        vscode.commands.registerCommand("tmc.updateExercises", async (silent: string) =>
            commands.updateExercises(actionContext, silent),
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.courseDetails", async () => {
            const courses = userData.getCourses();
            const options: [string, () => Thenable<void>][] = [];
            for (const course of courses) {
                options.push([
                    course.name,
                    async (): Promise<void> =>
                        actions.displayLocalCourseDetails(actionContext, course.id),
                ]);
            }
            (
                await askForItem<() => Thenable<unknown>>(
                    "Which course page do you want to open?",
                    false,
                    ...options,
                )
            )?.();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.login", async () => {
            const username = await vscode.window.showInputBox({
                placeHolder: "Enter username",
                prompt: "Please enter your TMC username",
            });
            const password = await vscode.window.showInputBox({
                placeHolder: "Enter password",
                prompt: "Please enter your TMC password",
                password: true,
            });
            if (username && password) {
                const authed = await actionContext.tmc.authenticate(username, password);
                if (authed.err) {
                    showError(`Failed to login. ${authed.val.message}.`);
                    return;
                }
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.logout", async () => {
            const deauth = await actionContext.tmc.deauthenticate();
            if (deauth.err) {
                showError(`Failed to logout. ${deauth.val.message}`);
                return;
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.addNewCourse", async () => {
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
                ...courses.val.map<[string, number]>((course) => [course.name, course.id]),
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
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.welcome", async () => {
            ui.webview.setContentFromTemplate(
                {
                    templateName: "welcome",
                    version: resources.extensionVersion,
                    newWorkspace: vscode.Uri.file(
                        path.join(resources.mediaFolder, "welcome_new_workspace.png"),
                    ),
                    openNewWorkspace: vscode.Uri.file(
                        path.join(resources.mediaFolder, "welcome_open_new_workspace.png"),
                    ),
                    TMCMenuIcon: vscode.Uri.file(
                        path.join(resources.mediaFolder, "welcome_tmc_menu_icon.png"),
                    ),
                    newTMCMenu: vscode.Uri.file(
                        path.join(resources.mediaFolder, "welcome_new_tmc_menu.png"),
                    ),
                    tmcLogoFile: vscode.Uri.file(path.join(resources.mediaFolder, "TMC.png")),
                },
                false,
                [
                    {
                        key: "insiderStatus",
                        message: { command: "setInsiderStatus", enabled: settings.isInsider() },
                    },
                ],
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.wipe", async () => {
            const workspace = vscode.workspace.name?.split(" ")[0];
            if (workspace && isCorrectWorkspaceOpen(resources, workspace)) {
                showNotification(
                    "Please close the TMC Workspace before wiping data and make sure you have closed all files related to TMC.",
                    ["OK", (): void => {}],
                );
                return;
            }
            const wipe = await askForConfirmation(
                "Are you sure you want to wipe all data for the TMC Extension?",
                true,
            );
            if (!wipe) {
                return;
            }
            const reallyWipe = await askForConfirmation(
                "This action cannot be undone. This might permanently delete the extension data, exercises, settings...",
                true,
            );
            if (reallyWipe) {
                await vscode.commands.executeCommand("tmc.logout");
                fs.removeSync(path.join(resources.getDataPath()));
                await userData.wipeDataFromStorage();
                deactivate();
                for (const sub of context.subscriptions) {
                    try {
                        sub.dispose();
                    } catch (e) {
                        Logger.error(e);
                    }
                }
                activate(context);
            }
        }),
    );
}
