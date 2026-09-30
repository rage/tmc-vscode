import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { Panel } from "../shared/shared"
import { assertUnreachable, LocalCourseData } from "../shared/shared"

/** The editor tab label for `route`, so tabs can be told apart in Open Editors and Ctrl+Tab. */
export function panelTitle(route: Panel, actionContext: ActionContext): string {
  switch (route.type) {
    case "CourseDetails": {
      const course = isReady(actionContext)
        ? actionContext.startup.userData.getCourse(route.courseId)
        : undefined
      return course?.ok ? LocalCourseData.getCourseTitle(course.val) : "Course Details"
    }
    case "ExerciseSubmission":
      return `Submission: ${route.exerciseSlug}`
    case "InitializationErrorHelp":
      return "TestMyCode Help"
    default:
      return assertUnreachable(route)
  }
}

let panelIdCounter = 0

/**
 * A panel id unique for the lifetime of the extension host, so a message can be matched
 * against the panel currently rendered.
 */
export function nextPanelId(): number {
  panelIdCounter += 1
  return panelIdCounter
}
