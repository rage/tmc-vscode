import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"

import { LocalCourseData } from "../../shared/lib"
import type { WorkspaceExercise } from "../api/workspaceManager"
import type { StoredExercise } from "../config/userdata"
import { ChapterNotOpenError, ExerciseRemovedError } from "../errors"
import { formatDateTime, parseDate } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * The stored course data of an exercise on disk. Errs when its course is still added but does
 * not list it: with `ChapterNotOpenError` while its chapter has not opened yet, otherwise with
 * `ExerciseRemovedError`, as after the teacher removed it.
 */
export function storedExerciseOf(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "courseId" | "exerciseSlug">,
): Result<StoredExercise, Error> {
  const { userData } = actionContext.startup
  const stored = userData.getExercise(exercise.id)
  const course = userData.getCourse(exercise.courseId)
  const closedChapter = course.ok
    ? LocalCourseData.getClosedChapterOf(course.val, exercise.id)
    : undefined
  if (stored.err && closedChapter) {
    const opensAt = parseDate(closedChapter.opensAt)
    const when = opensAt ? ` on ${formatDateTime(opensAt, vscode.env.language)}` : " later"
    return Err(
      new ChapterNotOpenError(
        `${exercise.exerciseSlug} is in the chapter "${closedChapter.name}", which opens${when}.` +
          " Until then it can't be submitted. Its files stay on this computer, and Run Tests" +
          " still works.",
      ),
    )
  }
  if (stored.err && course.ok) {
    return Err(
      new ExerciseRemovedError(
        `${exercise.exerciseSlug} was removed from the course, so it can no longer be ` +
          "submitted or restored. Its files stay on this computer, and Run Tests still works.",
      ),
    )
  }
  return stored
}
