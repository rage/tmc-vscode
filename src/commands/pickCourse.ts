import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { courseSelectionItems } from "../api/dialog"

interface PickCourseOptions {
  title: string
  placeHolder: string
  /** See `courseSelectionItems`. */
  decorate?: (course: LocalCourseData, title: string) => string
  /** Asks even when only one course is added, for an action not to take by default. */
  alwaysAsk?: boolean
}

/**
 * Prompts the user to pick one of their courses, the one whose workspace is open first.
 *
 * On an empty course list, offers to add one, or to log in first, instead of showing an empty
 * quick pick; with a single course, picks it without asking unless `alwaysAsk` is set.
 *
 * @returns The picked course, or `undefined` if there are no courses or the pick was
 * dismissed.
 */
export async function pickCourse(
  actionContext: ReadyActionContext,
  options: PickCourseOptions,
): Promise<CourseIdentifier | undefined> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  const courses = userData.getCourses()
  if (courses.length === 0) {
    // Adding a course takes a login first, which the course pick would only offer.
    await dialog.notification(
      "No courses added yet.",
      actionContext.authState.loggedIn
        ? ["Add Course", (): void => void vscode.commands.executeCommand("tmc.addNewCourse")]
        : ["Log In", (): void => void vscode.commands.executeCommand("tmc.showMoocLogin")],
    )
    return undefined
  }
  const { title, placeHolder, decorate, alwaysAsk } = options
  const [only, ...others] = courses
  if (only && others.length === 0 && !alwaysAsk) {
    return LocalCourseData.getCourseId(only)
  }
  const isOpen = (course: LocalCourseData): boolean =>
    course.kind === workspaceManager.activeCourseBackend &&
    LocalCourseData.getCourseName(course) === workspaceManager.activeCourse
  const ordered = [
    ...courses.filter((course) => isOpen(course)),
    ...courses.filter((course) => !isOpen(course)),
  ]
  return dialog.selectItem({ title, placeHolder }, ...courseSelectionItems(ordered, decorate))
}
