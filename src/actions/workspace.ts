/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import { Result } from "ts-results";
import * as vscode from "vscode";
import { ActionContext } from "./types";

/**
 * Downloads given exercises and opens them in TMC workspace.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    ids: number[],
    organizationSlug: string,
    courseName: string,
    courseId: number,
): Promise<void> {
    const { tmc, ui } = actionContext;

    const courseDetails = await tmc.getCourseDetails(courseId);
    if (courseDetails.err) {
        vscode.window.showErrorMessage(`Could not download exercises, course details not found: \
                                        ${courseDetails.val.name} - ${courseDetails.val.message}`);
        return;
    }

    const exerciseStatus = new Map<
        number,
        { name: string; downloaded: boolean; failed: boolean; error: string }
    >(
        courseDetails.val.course.exercises
            .filter((x) => ids.includes(x.id))
            .map((x) => [x.id, { name: x.name, downloaded: false, failed: false, error: "" }]),
    );

    let successful = 0;
    let failed = 0;

    ui.webview.setContentFromTemplate("downloading-exercises", {
        courseId,
        exercises: exerciseStatus.values(),
        failed,
        // eslint-disable-next-line @typescript-eslint/camelcase
        failed_pct: Math.round((100 * failed) / ids.length),
        remaining: ids.length - successful - failed,
        successful,
        // eslint-disable-next-line @typescript-eslint/camelcase
        successful_pct: Math.round((100 * successful) / ids.length),
        total: ids.length,
    });

    await Promise.all(
        ids.map<Promise<Result<string, Error>>>(
            (x) =>
                // eslint-disable-next-line no-async-promise-executor
                new Promise(async (resolve) => {
                    const res = await tmc.downloadExercise(x, organizationSlug);
                    const d = exerciseStatus.get(x);
                    if (d) {
                        if (res.ok) {
                            successful += 1;
                            d.downloaded = true;
                        } else {
                            failed += 1;
                            d.failed = true;
                            d.error = res.val.message;
                        }
                        exerciseStatus.set(x, d);
                        ui.webview.setContentFromTemplate("downloading-exercises", {
                            courseId,
                            exercises: exerciseStatus.values(),
                            failed,
                            // eslint-disable-next-line @typescript-eslint/camelcase
                            failed_pct: Math.round((100 * failed) / ids.length),
                            remaining: ids.length - successful - failed,
                            successful,
                            // eslint-disable-next-line @typescript-eslint/camelcase
                            successful_pct: Math.round((100 * successful) / ids.length),
                            total: ids.length,
                        });
                    }
                    resolve(res);
                }),
        ),
    );
}

/**
 * Sends given exercise to the server and resets it to initial state.
 * @param id ID of the exercise to reset
 */
export async function resetExercise(id: number, actionContext: ActionContext) {
    const { ui, tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);

    if (exerciseData.err) {
        vscode.window.showErrorMessage("The data for this exercise seems to be missing");
        return;
    }

    const submitResult = await tmc.submitExercise(id);
    if (submitResult.err) {
        vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
       ${submitResult.val.name} - ${submitResult.val.message}`);
        ui.setStatusBar(
            `Something went wrong while resetting exercise ${exerciseData.val.name}`,
            10000,
        );
        return;
    }

    vscode.window.showInformationMessage(`Resetting exercise ${exerciseData.val.name}`);
    ui.setStatusBar(`Resetting exercise ${exerciseData.val.name}`);

    const slug = exerciseData.val.organization;
    workspaceManager.deleteExercise(id);
    await tmc.downloadExercise(id, slug, true);
    ui.setStatusBar(`Exercise ${exerciseData.val.name} resetted successfully`, 10000);
}

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function openExercises(ids: number[], actionContext: ActionContext) {
    const { workspaceManager } = actionContext;
    ids.forEach((id) => workspaceManager.openExercise(id));
}

/**
 * Closes given exercises, hiding them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(ids: number[], actionContext: ActionContext) {
    const { workspaceManager } = actionContext;
    ids.forEach((id) => workspaceManager.closeExercise(id));
}
