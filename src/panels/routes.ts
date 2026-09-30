import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { CourseDetailsPanel, Panel } from "../shared/shared"
import { assertUnreachable, LocalCourseData, LocalCourseExercise } from "../shared/shared"

/**
 * Which screen a webview shows: the panel minus the view state the host fills in.
 *
 * What a caller navigates with and what `TmcPanel` remembers. The data a screen renders
 * reaches it separately, as messages, so remembering a route never goes stale.
 */
export type PanelRoute =
  | Exclude<Panel, CourseDetailsPanel>
  | Pick<CourseDetailsPanel, "id" | "type" | "courseId">

/** The editor tab label for `route`, so tabs can be told apart in Open Editors and Ctrl+Tab. */
export function panelTitle(route: PanelRoute, actionContext: ActionContext): string {
  switch (route.type) {
    case "App":
      return "TestMyCode"
    case "CourseDetails": {
      const course = isReady(actionContext)
        ? actionContext.startup.userData.getCourse(route.courseId)
        : undefined
      return course?.ok ? LocalCourseData.getCourseTitle(course.val) : "Course Details"
    }
    case "ExerciseSubmission":
      return `Submission: ${LocalCourseExercise.getSlug(route.exercise)}`
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
