import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { OldSubmission } from "../api/types";
import { dateToString, Logger, parseDate } from "../utils";

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

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseId = userData.getExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id;
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

    if (submissionsResult.val.length === 0) {
        dialog.notification(`No previous submissions found for exercise ${exerciseId}`);
        return;
    }

    const submission = await dialog.selectItem(
        exercise.exerciseSlug + ": Select a submission",
        ...submissionsResult.val.map<[string, OldSubmission]>((a) => [
            dateToString(parseDate(a.processing_attempts_started_at)) +
                "| " +
                (a.all_tests_passed ? "Passed" : "Not passed"),
            a,
        ]),
    );
    if (!submission) {
        return;
    }

    const submitFirst = await dialog.confirmation(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
    );
    if (submitFirst === undefined) {
        Logger.debug("Answer for submitting first not provided, returning early.");
        return;
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
        vscode.commands.executeCommand<undefined>("vscode.open", document, editor.viewColumn);
    }
}
