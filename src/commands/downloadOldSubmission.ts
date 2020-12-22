import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { OldSubmission } from "../api/types";
import { dateToString, Logger, parseDate } from "../utils";
import { askForItem, showError, showNotification } from "../window";

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
    const { tmc, userData, workspaceManager } = actionContext;

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        Logger.error("Currently open editor is not part of a TMC exercise.");
        showError("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseId = userData.getExerciseByName(exercise.name)?.id;
    if (!exerciseId) {
        Logger.error("Failed to resolve exercise id.");
        showError("Failed to resolve exercise id.");
        return;
    }

    Logger.debug("Fetching old submissions");
    const submissionsResult = await tmc.getOldSubmissions(exerciseId);
    if (submissionsResult.err) {
        Logger.error("Failed to fetch old submissions:", submissionsResult.val);
        showError("Failed to fetch old submissions.");
        return;
    }

    if (submissionsResult.val.length === 0) {
        Logger.log(`No previous submissions found for exercise ${exerciseId}`);
        showNotification(`No previous submissions found for ${exercise.name}.`);
        return;
    }

    const submission = await askForItem(
        exercise.name + ": Select a submission",
        false,
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

    const submitFirst = await askForItem(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
        false,
        ["Yes", true],
        ["No", false],
        ["Cancel", undefined],
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
        Logger.error("Failed to download old submission", oldDownloadResult.val);
        showError(`Failed to download old submission: ${oldDownloadResult.val.message}`);
    }

    if (editor && document) {
        vscode.commands.executeCommand<undefined>("vscode.open", document, editor.viewColumn);
    }
}
