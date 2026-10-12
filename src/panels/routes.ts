import type * as vscode from "vscode"

import type { ActionContext, StartupStep } from "../actions/types"
import { isReady } from "../actions/types"
import type { InitializationErrorHelpPanel, Panel } from "../shared/shared"
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
    failures: STARTUP_STEPS.flatMap((step) => {
      const error = failures[step]
      return error
        ? [
            {
              service: SERVICE_NAMES[step],
              error: error.cause ? `${error.message}: ${error.cause}` : error.message,
              stack: error.stack ?? "no stack trace",
              ...(step === "langs" ? { hint: cliHint } : {}),
            },
          ]
        : []
    }),
  }
}

/** `DegradedStartup.failures` keys, named for the student. */
const SERVICE_NAMES: Record<StartupStep, string> = {
  langs: "tmc-langs",
  resources: "extension files",
  userData: "user data",
}

const STARTUP_STEPS = Object.keys(SERVICE_NAMES) as StartupStep[]
