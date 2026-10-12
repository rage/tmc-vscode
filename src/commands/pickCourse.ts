import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { courseSelectionItems } from "../api/dialog"
import type { CourseIdentifier, LocalCourseData } from "../shared/shared"

interface PickCourseOptions {
  title: string
  placeHolder: string
  /** See `courseSelectionItems`. */
  decorate?: (course: LocalCourseData, title: string) => string
}

/**
 * Prompts the user to pick one of their courses.
 *
 * On an empty course list, offers to add one instead of showing an empty quick pick.
 *
 * @returns The picked course, or `undefined` if there are no courses or the pick was
 * dismissed.
 */
export async function pickCourse(
  actionContext: ReadyActionContext,
  options: PickCourseOptions,
): Promise<CourseIdentifier | undefined> {
  const { dialog } = actionContext
  const courses = actionContext.startup.userData.getCourses()
  if (courses.length === 0) {
    await dialog.notification("No courses added yet.", [
      "Add a course",
      (): void => void vscode.commands.executeCommand("tmc.addNewCourse"),
    ])
    return undefined
  }
  const { title, placeHolder, decorate } = options
  return dialog.selectItem({ title, placeHolder }, ...courseSelectionItems(courses, decorate))
}
