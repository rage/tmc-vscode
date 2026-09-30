import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { shownInPanel, withOperation } from "../../api/withOperation"
import type { CourseDetailsPanel, TargetPanel } from "../../shared/shared"
import { CourseIdentifier, LocalCourseData, panelTarget } from "../../shared/shared"
import { Logger } from "../../utilities"
import { panelActions } from "../panelActions"
import type { HandlerMap, PanelHost } from "../router"

/** The CourseDetails screen's messages. */
export const courseDetailsHandlers = {
  requestCourseDetailsData: {
    requiresReady: true,
    handle(message, { host, actionContext }): Result<undefined, Error> {
      const courseResult = actionContext.startup.userData.getCourse(message.sourcePanel.courseId)
      if (courseResult.err) {
        Logger.error("Failed to read the course.", courseResult.val)
        return courseResult
      }
      host.post({
        type: "setCourseData",
        target: panelTarget(message.sourcePanel),
        courseData: courseResult.val,
      })
      return Ok(undefined)
    },
  },
  refreshCourseDetails: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      const courseId = message.id
      const updateResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to update course.", backend: courseId.kind },
        async () => {
          const updated = await panelActions().updateCourse(actionContext, courseId)
          return updated.err ? shownInPanel(updated.val) : updated
        },
      )
      // `updateCourse` does not rescan, and the Courses view shows what is on disk.
      const rescanResult = await panelActions().refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      const course = actionContext.startup.userData.getCourse(courseId)
      if (course.err) {
        return course
      }
      // Pushed to the panel in place: re-rendering it would drag the student back here if
      // they had navigated away.
      const target = courseDetailsShowing(host, courseId)
      if (target) {
        host.post({ type: "setCourseData", target, courseData: course.val })
      }
      return updateResult.err ? updateResult : Ok(undefined)
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

/** The panel `host` shows, if it is `courseId`'s CourseDetails. */
function courseDetailsShowing(
  host: PanelHost,
  courseId: CourseIdentifier,
): TargetPanel<CourseDetailsPanel> | undefined {
  const route = host.route
  return route?.type === "CourseDetails" &&
    route.courseId.kind === courseId.kind &&
    CourseIdentifier.toString(route.courseId) === CourseIdentifier.toString(courseId)
    ? panelTarget(route)
    : undefined
}
