import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { OldSubmission } from "../api/types";
import { dateToString, Logger, parseDate } from "../utilities";

/**
 * Looks for older submissions of the given exercise and lets user choose which one to download.
 * Uses resetExercise action before applying the contents of the actual submission.
 *
 * @param exerciseId exercise which older submission will be downloaded
 */
export async function downloadOldSubmission(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, tmc, userData, workspaceManager } = actionContext;
    Logger.info("Downloading old submission");

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseId = userData.getTmcExerciseByName(
        exercise.courseSlug,
        exercise.exerciseSlug,
    )?.id;
    if (!exerciseId) {
        dialog.errorNotification("Failed to resolve exercise id.");
        return;
    }

    Logger.debug("Fetching old submissions");
    const submissionsResult = await tmc.getOldSubmissions(exerciseId);
    if (submissionsResult.err) {
        dialog.errorNotification("Failed to fetch old submissions.", submissionsResult.val);
        return;
    }

    submissionsResult.val.sort(
        (a, b) => parseDate(a.created_at).getTime() - parseDate(b.created_at).getTime(),
    );
    if (submissionsResult.val.length === 0) {
        dialog.notification(`No previous submissions found for exercise ${exerciseId}`);
        return;
    }

    const submission = await dialog.selectItem(
        exercise.exerciseSlug + ": Select a submission",
        ...submissionsResult.val.map<[string, OldSubmission]>((a) => [
            dateToString(parseDate(a.created_at)) +
                "| " +
                (a.all_tests_passed ? "Passed" : "Not passed"),
            a,
        ]),
    );
    if (!submission) {
        return;
    }

    const submitFirstSelection = await dialog.selectItem(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
        ["Submit to server", "submit"],
        ["Discard current state", "discard"],
    );
    if (submitFirstSelection === undefined) {
        Logger.debug("Answer for submitting first not provided, returning early.");
        return;
    }

    let submitFirst = submitFirstSelection === "submit";
    // if we're submitting first, nothing will be lost anyway so it's probably okay to not annoy the user with a double confirm
    if (!submitFirst) {
        const confirm = await dialog.selectItem(
            "Are you sure?",
            ["No, save the current exercise state", "submit"],
            ["Yes, discard current state", "discard"],
        );
        if (confirm === undefined) {
            return;
        }
        submitFirst = confirm === "submit";
    }

    const editor = vscode.window.activeTextEditor;
    const document = editor?.document.uri;

    const oldDownloadResult = await tmc.downloadOldSubmission(
        exerciseId,
        exercise.uri.fsPath,
        submission.id,
        submitFirst,
    );
    if (oldDownloadResult.err) {
        dialog.errorNotification("Failed to download old submission.", oldDownloadResult.val);
    }

    if (editor && document) {
        await vscode.commands.executeCommand("workbench.action.files.revert", document);
    }
}
