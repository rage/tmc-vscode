import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import { EXTENSION_VERSION } from "../config/constants"
import type { CourseDetailsPanel, MyCoursesPanel, Panel, WelcomePanel } from "../shared/shared"
import { assertUnreachable, LocalCourseData, LocalCourseExercise } from "../shared/shared"

/**
 * Which screen a webview shows: the panel minus the view state the host fills in.
 *
 * What a caller navigates with and what `TmcPanel` remembers. The data a screen renders
 * reaches it separately, as messages, so remembering a route never goes stale.
 */
export type PanelRoute =
  | Exclude<Panel, CourseDetailsPanel | MyCoursesPanel | WelcomePanel>
  | Pick<CourseDetailsPanel, "id" | "type" | "courseId">
  | Pick<MyCoursesPanel, "id" | "type">
  | Pick<WelcomePanel, "id" | "type">

/** The panel `setPanel` renders for `route`, as of now. */
export function completePanel(route: PanelRoute, actionContext: ActionContext): Panel {
  switch (route.type) {
    case "Welcome":
      return { ...route, version: EXTENSION_VERSION, loggedIn: actionContext.authState.loggedIn }
    case "CourseDetails":
      return { ...route, exerciseStatuses: { tmc: {}, mooc: {} } }
    default:
      return route
  }
}

/** The editor tab label for `route`, so tabs can be told apart in Open Editors and Ctrl+Tab. */
export function panelTitle(route: PanelRoute, actionContext: ActionContext): string {
  switch (route.type) {
    case "App":
      return "TestMyCode"
    case "Welcome":
      return "Welcome"
    case "MyCourses":
      return "My Courses"
    case "CourseDetails": {
      const course = isReady(actionContext)
        ? actionContext.startup.userData.getCourse(route.courseId)
        : undefined
      return course?.ok ? LocalCourseData.getCourseTitle(course.val) : "Course Details"
    }
    case "ExerciseTests":
      return `Tests: ${LocalCourseExercise.getSlug(route.exercise)}`
    case "ExerciseSubmission":
      return `Submission: ${LocalCourseExercise.getSlug(route.exercise)}`
    case "MoocLogin":
      return "Log In"
    case "InitializationErrorHelp":
      return "TestMyCode Help"
    default:
      return assertUnreachable(route)
  }
}

/**
 * Whether showing `route` in the side panel should move keyboard focus into it.
 *
 * Only a side panel the user asked for takes focus; test and submission results appear
 * while the student is typing, and a re-run must not pull their keystrokes away.
 */
export function takesFocus(route: PanelRoute): boolean {
  return route.type === "MoocLogin"
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
