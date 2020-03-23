import { ActionContext } from "./types";
import { askForItem } from "../utils";
import { pasteExercise, submitExercise, testExercise } from "./user";

export * from "./user";
export * from "./webview";
export * from "./workspace";

export async function selectAction(
    actionContext: ActionContext,
    exerciseId: number,
): Promise<void> {
    const options: [string, () => Promise<unknown>][] = [
        ["Run tests", (): Promise<void> => testExercise(actionContext, exerciseId)],
        ["Submit to server", (): Promise<void> => submitExercise(actionContext, exerciseId)],
        ["Upload to TMC Pastebin", (): Promise<void> => pasteExercise(actionContext, exerciseId)],
        // Disabled now because doesn't ask for confirmation
        // ["Close exercise", (): Promise<void> => closeExercises(actionContext, [exerciseId])],
        // ["Reset exercise", (): Promise<Result<void, Error>> => resetExercise(actionContext, exerciseId)]
    ];

    (await askForItem<() => Promise<unknown>>("Select TMC Action", options))?.();
}
