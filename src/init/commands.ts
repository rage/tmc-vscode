import * as vscode from "vscode";

import * as actions from "../actions";
import { checkForCourseUpdates, displayUserCourses, removeCourse } from "../actions";
import { ActionContext } from "../actions/types";
import * as commands from "../commands";
import { TmcPanel } from "../panels/TmcPanel";
import { TmcTreeNode } from "../ui/treeview/treenode";
import { TemplateData } from "../ui/types";
import { Logger } from "../utilities/";

export function registerCommands(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): void {
    const { dialog, ui, userData } = actionContext;
    Logger.info("Registering TMC VSCode commands");

    // Commands not shown to user in Command Palette / TMC Action menu
    context.subscriptions.push(
        vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        vscode.commands.registerCommand(
            "tmcTreeView.setContentFromTemplate",
            (template: TemplateData) => {
                ui.webview.setContentFromTemplate(template);
            },
        ),
        vscode.commands.registerCommand(
            "tmcTreeView.removeCourse",
            async (treeNode: TmcTreeNode) => {
                const confirmed = await dialog.confirmation(
                    `Do you want to remove ${treeNode.label} from your courses? This won't delete your downloaded exercises.`,
                );
                if (confirmed) {
                    await removeCourse(actionContext, Number(treeNode.id));
                    await displayUserCourses(actionContext);
                }
            },
        ),
        vscode.commands.registerCommand("tmcTreeView.refreshCourses", async () => {
            await checkForCourseUpdates(actionContext);
            await commands.updateExercises(actionContext, "loud");
        }),
    );

    // Commands shown to user in Command Palette / TMC Action menu
    context.subscriptions.push(
        vscode.commands.registerCommand("tmc.addNewCourse", async () =>
            commands.addNewCourse(actionContext),
        ),

        vscode.commands.registerCommand("tmc.changeTmcDataPath", async () =>
            commands.changeTmcDataPath(actionContext),
        ),

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

        vscode.commands.registerCommand("tmc.courseDetails", async (courseId?: number) => {
            const courses = userData.getCourses();
            if (courses.length === 0) {
                return;
            }
            courseId =
                courseId ??
                (await dialog.selectItem(
                    "Which course page do you want to open?",
                    ...courses.map<[string, number]>((c) => [c.title, c.id]),
                ));
            if (courseId) {
                // actions.displayLocalCourseDetails(actionContext, courseId);
                TmcPanel.render(context.extensionUri, actionContext, {
                    type: "CourseDetails",
                    args: { courseId },
                });
            }
        }),

        vscode.commands.registerCommand("tmc.downloadNewExercises", async () =>
            commands.downloadNewExercises(actionContext),
        ),

        vscode.commands.registerCommand(
            "tmc.downloadOldSubmission",
            async (resource: vscode.Uri | undefined) =>
                commands.downloadOldSubmission(actionContext, resource),
        ),

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
                const authed = await actions.login(actionContext, username, password);
                if (authed.err) {
                    dialog.errorNotification(`Failed to login: ${authed.val.message}.`, authed.val);
                }
            }
        }),

        vscode.commands.registerCommand("tmc.logout", async () => {
            if (await dialog.confirmation("Are you sure you want to log out?")) {
                const { ui } = actionContext;
                const deauth = await actions.logout(actionContext);
                if (deauth.err) {
                    dialog.errorNotification(
                        `Failed to logout: ${deauth.val.message}.`,
                        deauth.val,
                    );
                    return;
                }
                ui.webview.dispose();
                dialog.notification("Logged out from TestMyCode.");
            }
        }),

        vscode.commands.registerCommand("tmc.myCourses", async () => {
            TmcPanel.render(context.extensionUri, actionContext, { type: "MyCourses" });
        }),

        vscode.commands.registerCommand("tmc.openSettings", async () => {
            vscode.commands.executeCommand("workbench.action.openSettings", "TestMyCode");
        }),

        vscode.commands.registerCommand("tmc.openTMCExercisesFolder", async () => {
            vscode.commands.executeCommand(
                "revealFileInOS",
                vscode.Uri.file(actionContext.resources.projectsDirectory),
            );
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

        vscode.commands.registerCommand("tmc.showWelcome", async () => {
            TmcPanel.render(context.extensionUri, actionContext, { type: "Welcome" });
        }),

        vscode.commands.registerCommand("tmc.showLogin", async () => {
            TmcPanel.render(context.extensionUri, actionContext, { type: "Login" });
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

        vscode.commands.registerCommand("tmc.wipe", async () =>
            commands.wipe(actionContext, context),
        ),
    );
}
