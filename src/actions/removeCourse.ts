import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import { failure } from "../api/withOperation"
import { closedExercisesSettingKey } from "../config/constants"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * Removes a course from the user's courses, along with the extension's own state
 * for it: its closed-exercise setting and its `.code-workspace` file.
 *
 * The exercises already downloaded are deliberately left on disk. Failing to clean up the
 * setting or the workspace file is reported and does not stop the removal; an `Err` means
 * the course is still in the user's courses.
 *
 * @param id ID of the course to remove
 */
export async function removeCourse(
  actionContext: ReadyActionContext,
  id: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { dialog, ui } = actionContext
  const { langs, userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(id)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseName = LocalCourseData.getCourseName(course)
  Logger.info(`Closing exercises for ${courseName} and removing course data from userData`)

  const unsetResult = await langs.unsetSetting(closedExercisesSettingKey(course.kind, courseName))
  if (unsetResult.err) {
    dialog.reportError(
      `Failed to remove TMC-langs data for "${courseName}".`,
      unsetResult.val,
      course.kind,
    )
  }

  // Left behind, it would be reused verbatim if the course is added again, listing
  // folders for exercises the student may have deleted in the meantime.
  const workspaceFileResult = await workspaceManager.deleteWorkspaceFile(courseName, course.kind)
  if (workspaceFileResult.err) {
    dialog.reportError(
      `Failed to remove the workspace file for "${courseName}".`,
      workspaceFileResult.val,
      course.kind,
    )
  }

  const deleteResult = await userData.deleteCourse(id)
  if (deleteResult.err) {
    return failure(
      `Failed to remove "${courseName}" from your courses.`,
      deleteResult.val,
      course.kind,
    )
  }
  ui.treeDP.refresh()

  if (
    workspaceManager.activeCourse === courseName &&
    workspaceManager.activeCourseBackend === course.kind
  ) {
    Logger.info("Closing course workspace because it was removed.")
    await vscode.commands.executeCommand("workbench.action.closeFolder")
  }
  return Ok.EMPTY
}
