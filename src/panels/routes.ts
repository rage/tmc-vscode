import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { BackendKind, InitializationErrorHelpPanel, Panel } from "../shared/shared"
import { assertUnreachable, LocalCourseData } from "../shared/shared"
import { cliFolder } from "../utilities"

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

/** The backend `route` shows data of, if it shows any. */
export function backendOf(route: Panel | undefined): BackendKind | undefined {
  switch (route?.type) {
    case "CourseDetails":
      return route.courseId.kind
    case "ExerciseSubmission":
      return route.backend
    default:
      return undefined
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

/** A new help panel for the activation failures `actionContext` holds, if any. */
export function initializationErrorHelpPanel(
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext,
): InitializationErrorHelpPanel {
  const failures = actionContext.startup.kind === "degraded" ? actionContext.startup.failures : {}
  const cliHint =
    "A proxy, firewall or antivirus program blocking network requests can cause this. " +
    `Try adding an exception for the directory '${cliFolder(extensionContext)}'.`
  return {
    id: nextPanelId(),
    type: "InitializationErrorHelp",
    failures: Object.entries(failures).map(([service, error]) => ({
      service: SERVICE_NAMES[service] ?? service,
      error: error.cause ? `${error.message}: ${error.cause}` : error.message,
      stack: error.stack ?? "no stack trace",
      ...(service === "langs" ? { hint: cliHint } : {}),
    })),
  }
}

/** `DegradedStartup.failures` keys, named for the student. */
const SERVICE_NAMES: Partial<Record<string, string>> = {
  langs: "tmc-langs",
  userData: "user data",
  workspaceManager: "workspace manager",
  exerciseDecorationProvider: "exercise decoration provider",
}
