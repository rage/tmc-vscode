import type * as vscode from "vscode"

import type { ExerciseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import { downloadAndOpenExercises } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { exerciseFor } from "../api/workspaceManager"
import { showExerciseSourceFile } from "../ui/exerciseSourceFile"
import { nextExerciseAfter } from "../ui/treeview/courseViewModel"

/**
 * Opens the exercise to do after this one, downloading it when needed, and shows its main
 * source file.
 *
 * @param from The exercise just worked on: its id, or a file or folder of it; the active
 * editor's exercise when omitted.
 */
export async function openNextExercise(
  actionContext: ReadyActionContext,
  from: ExerciseIdentifier | vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  const currentId =
    from !== undefined && "kind" in from ? from : exerciseFor(workspaceManager, from)?.id
  if (!currentId) {
    void dialog.errorNotification("Open a file of an exercise first.")
    return
  }
  const stored = userData.getExercise(currentId)
  if (stored.err) {
    void dialog.reportError("Failed to find the next exercise.", stored.val)
    return
  }
  const { course } = stored.val
  const nextId = nextExerciseAfter(course, currentId, new Date())
  if (!nextId) {
    dialog.statusMessage(`No exercise is left to do in ${LocalCourseData.getCourseTitle(course)}.`)
    return
  }
  const opened = await withOperation(dialog, { failure: "Failed to open the next exercise." }, () =>
    downloadAndOpenExercises(actionContext, [nextId], LocalCourseData.getCourseId(course)),
  )
  const next = opened.ok ? workspaceManager.getExercise(nextId) : undefined
  if (next) {
    await showExerciseSourceFile(actionContext, next)
  }
}
