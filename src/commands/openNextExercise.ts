import * as vscode from "vscode"

import type { ExerciseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import { downloadAndOpenExercises } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { reportFailureIn, withOperation } from "../api/withOperation"
import { exerciseFor } from "../api/workspaceManager"
import { exerciseToContinue, openCourseId } from "../ui/courseHome"
import { showExerciseSourceFile } from "../ui/exerciseSourceFile"
import { lastExerciseReached } from "../ui/lastExerciseReached"
import { shownCourseHome } from "../ui/shownCourseHome"
import { nextExerciseAfter } from "../ui/treeview/courseViewModel"
import { pickCourse } from "./pickCourse"

const OPEN_NEXT_FAILED = "Failed to open the next exercise."

interface NextExercise {
  course: LocalCourseData
  nextId: ExerciseIdentifier | undefined
}

/**
 * Opens the exercise to do after this one, downloading it when needed, and shows its main
 * source file. Opens the course home when none after it is left, and to show why the next one
 * could not be opened.
 *
 * @param from The exercise just worked on: its id, or a file or folder of it; the active
 * editor's exercise when omitted. With neither, opens the exercise the course home's Continue
 * would, in the open course workspace's course or else one the user picks.
 */
export async function openNextExercise(
  actionContext: ReadyActionContext,
  from: ExerciseIdentifier | vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { workspaceManager } = actionContext.startup
  const found = await findNextExercise(actionContext, from)
  if (!found) {
    return
  }
  const { course, nextId } = found
  const courseId = LocalCourseData.getCourseId(course)
  if (!nextId) {
    lastExerciseReached.add(courseId)
    await vscode.commands.executeCommand("tmc.courseDetails", courseId)
    return
  }
  lastExerciseReached.clear(courseId)
  // Shown in the course home, which lists the exercise and what can be done with it.
  const opened = await withOperation(dialog, { failure: OPEN_NEXT_FAILED, silent: true }, () =>
    downloadAndOpenExercises(actionContext, [nextId], courseId),
  )
  if (opened.err) {
    await vscode.commands.executeCommand("tmc.courseDetails", courseId)
    reportFailureIn(dialog, shownCourseHome.failureSink(courseId), OPEN_NEXT_FAILED, opened.val)
    return
  }
  const next = workspaceManager.getExercise(nextId)
  if (next) {
    await showExerciseSourceFile(actionContext, next)
  }
}

/** `undefined` once the user has been told why there is none, or dismissed the course pick. */
async function findNextExercise(
  actionContext: ReadyActionContext,
  from: ExerciseIdentifier | vscode.Uri | undefined,
): Promise<NextExercise | undefined> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  const currentId =
    from !== undefined && "kind" in from ? from : exerciseFor(workspaceManager, from)?.id
  if (currentId) {
    const stored = userData.getExercise(currentId)
    if (stored.err) {
      void dialog.reportError("Failed to find the next exercise.", stored.val)
      return undefined
    }
    const { course } = stored.val
    return { course, nextId: nextExerciseAfter(course, currentId, new Date()) }
  }
  if (from !== undefined) {
    void dialog.errorNotification("Open a file of an exercise first.")
    return undefined
  }
  const courseId =
    openCourseId(actionContext) ??
    (await pickCourse(actionContext, {
      title: "Open Next Exercise",
      placeHolder: "Which course do you want to continue?",
    }))
  if (!courseId) {
    return undefined
  }
  const stored = userData.getCourse(courseId)
  if (stored.err) {
    void dialog.reportError("Failed to find the next exercise.", stored.val)
    return undefined
  }
  return { course: stored.val, nextId: exerciseToContinue(actionContext, stored.val) }
}
