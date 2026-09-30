import type { Result } from "ts-results"
import { Err } from "ts-results"

import { shownInPanel, withOperation } from "../../api/withOperation"
import { LocalCourseData } from "../../shared/shared"
import { Logger } from "../../utilities"
import { panelActions } from "../panelActions"
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
      const updateResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to update course.", backend: courseId.kind },
        async () => {
          const updated = await panelActions().updateCourse(actionContext, courseId)
          return updated.err ? shownInPanel(updated.val) : updated
        },
      )
      // `updateCourse` does not rescan, and a course update can drop exercises still on disk.
      const rescanResult = await panelActions().refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      if (updateResult.err) {
        return updateResult
      }
      return actionContext.startup.userData.getCourse(courseId)
    },
  },
  openCourseWorkspace: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<void> {
      const courseResult = actionContext.startup.userData.getCourse(message.courseId)
      if (courseResult.err) {
        actionContext.dialog.reportError("Failed to read the course.", courseResult.val)
        return
      }
      await panelActions().openWorkspace(
        actionContext,
        LocalCourseData.getCourseName(courseResult.val),
        message.courseId.kind,
      )
    },
  },
} satisfies Partial<HandlerMap>
