import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../../shared/lib"
import { assertUnreachable } from "../../../shared/lib"
import * as actions from "../../actions"
import { withOperation } from "../../api/withOperation"
import { Logger } from "../../utilities"
import type { HandlerMap } from "../router"

/** The CourseDetails screen's messages. */
export const courseDetailsHandlers = {
  requestCourseDetailsData: {
    requiresReady: true,
    handle(message, { actionContext }): Result<LocalCourseData, Error> {
      const courseResult = actionContext.startup.userData.getCourse(message.sourcePanel.courseId)
      if (courseResult.err) {
        Logger.error("Failed to read the course.", courseResult.val)
      }
      return courseResult
    },
  },
  refreshCourseDetails: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<LocalCourseData, Error>> {
      const route = host.route
      if (route?.type !== "CourseDetails" || route.id !== message.sourcePanel.id) {
        return Err(new Error("This panel no longer shows a course."))
      }
      const { courseId } = route
      // Silent: the panel that asked shows the failure, remedies included.
      const updateResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to update course.", silent: true },
        () => actions.updateCourse(actionContext, courseId),
      )
      // `updateCourse` does not rescan, and a course update can drop exercises still on disk.
      const rescanResult = await actions.refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      if (updateResult.err) {
        return updateResult
      }
      return actionContext.startup.userData.getCourse(courseId)
    },
  },
  courseAction: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const route = host.route
      if (route?.type !== "CourseDetails" || route.id !== message.sourcePanel.id) {
        Logger.warn("Ignoring a course action from a panel that no longer shows a course")
        return
      }
      switch (message.action) {
        case "downloadAllExercises":
          await vscode.commands.executeCommand("tmc.downloadAllExercises", route.courseId)
          return
        case "revealInCoursesView":
          await actionContext.coursesTree.revealCourse(route.courseId)
          return
        default:
          assertUnreachable(message.action)
      }
    },
  },
  openCourseWorkspace: {
    requiresReady: true,
    async handle(message): Promise<void> {
      // Opening a workspace may ask first, which is the command layer's to do.
      await vscode.commands.executeCommand("tmc.openCourseWorkspace", message.courseId)
    },
  },
} satisfies Partial<HandlerMap>
