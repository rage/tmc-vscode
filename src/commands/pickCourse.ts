import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { courseSelectionItems } from "../api/dialog"
import type { CourseIdentifier, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"

interface PickCourseOptions {
  title: string
  placeHolder: string
}

/**
 * Prompts the user to pick one of their courses.
 *
 * On an empty course list, offers to add one instead of showing an empty quick pick.
 *
 * @returns The picked course, or `undefined` if there are no courses, the pick was
 * dismissed, or the extension is not initialized. Picking yields a
 * {@link CourseIdentifier} unless `value` says otherwise.
 */
export async function pickCourse(
  actionContext: ActionContext,
  options: PickCourseOptions,
): Promise<CourseIdentifier | undefined>
export async function pickCourse<T>(
  actionContext: ActionContext,
  options: PickCourseOptions & {
    value: (course: LocalCourseData) => T
    decorate?: (course: LocalCourseData, title: string) => string
  },
): Promise<T | undefined>
export async function pickCourse<T>(
  actionContext: ActionContext,
  options: PickCourseOptions & {
    value?: (course: LocalCourseData) => T
    decorate?: (course: LocalCourseData, title: string) => string
  },
): Promise<T | CourseIdentifier | undefined> {
  const { dialog, userData } = actionContext
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return undefined
  }

  const courses = userData.val.getCourses()
  if (courses.length === 0) {
    await dialog.notification("No courses added yet.", [
      "Add a course",
      (): void => void vscode.commands.executeCommand("tmc.addNewCourse"),
    ])
    return undefined
  }

  // Omit `decorate` rather than pass `decorate: options.decorate`, since
  // `exactOptionalPropertyTypes` rejects an optional field explicitly set to `undefined`.
  const { decorate, value } = options
  if (value) {
    const items = decorate
      ? courseSelectionItems(courses, { value, decorate })
      : courseSelectionItems(courses, { value })
    return dialog.selectItem(options, ...items)
  }
  const items = decorate
    ? courseSelectionItems(courses, { decorate })
    : courseSelectionItems(courses)
  return dialog.selectItem(options, ...items)
}
