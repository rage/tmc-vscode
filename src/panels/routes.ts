import type * as vscode from "vscode"

import type {
  AddCoursePanel,
  ErrorHelpPanel,
  ExerciseSubmissionPanel,
  Panel,
} from "../../shared/lib"
import { assertUnreachable, BaseError, LocalCourseData, unwrap } from "../../shared/lib"
import type { ActionContext, StartupStep } from "../actions/types"
import { isReady } from "../actions/types"
import { errorDetails } from "../api/errorDetails"
import type { WorkspaceExercise } from "../api/workspaceManager"
import type Settings from "../config/settings"
import type { StoredExercise } from "../config/userdata"
import { CliVerificationError } from "../errors"
import { cliFolder, redactPersonalInfo } from "../utilities"

/** The editor tab label for `route`, so tabs can be told apart in Open Editors and Ctrl+Tab. */
export function panelTitle(route: Panel, actionContext: ActionContext): string {
  switch (route.type) {
    case "CourseDetails": {
      const course = isReady(actionContext)
        ? actionContext.startup.userData.getCourse(route.courseId)
        : undefined
      return course?.ok ? LocalCourseData.getCourseTitle(course.val) : "Course Home"
    }
    case "ExerciseSubmission":
      return `Results: ${route.exerciseName}`
    case "ErrorHelp":
      return route.topic.kind === "operation" ? "Error Details" : "TestMyCode Help"
    case "Login":
      return "Log In"
    case "AddCourse":
      return "Add Course"
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

/** A new add-course screen, listing courses.mooc.fi courses only when the setting allows. */
export function addCoursePanel(settings: Pick<Settings, "isCoursesMoocFiEnabled">): AddCoursePanel {
  return {
    id: nextPanelId(),
    type: "AddCourse",
    canAddMoocCourses: settings.isCoursesMoocFiEnabled(),
  }
}

/** A new results panel for `exercise`, named as its stored course names it. */
export function exerciseSubmissionPanel(
  exercise: Pick<WorkspaceExercise, "id" | "backend">,
  { course, exercise: courseExercise }: StoredExercise,
): ExerciseSubmissionPanel {
  return {
    id: nextPanelId(),
    type: "ExerciseSubmission",
    exerciseId: exercise.id,
    backend: exercise.backend,
    exerciseName: unwrap(courseExercise).name,
    courseTitle: LocalCourseData.getCourseTitle(course),
    ...(course.kind === "mooc" ? { organization: course.data.organization } : {}),
  }
}

/**
 * A new help panel: the activation's failures after a failed start, else what to try when the
 * TestMyCode tools fail.
 */
export function initializationErrorHelpPanel(
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext,
): ErrorHelpPanel {
  const exception =
    "Try adding an exception for the directory " +
    `'${redactPersonalInfo(cliFolder(extensionContext))}'.`
  if (actionContext.startup.kind !== "degraded") {
    const hint =
      "An antivirus program can stop the TestMyCode tools from running, and a proxy or " +
      `firewall can block their network requests. ${exception}`
    return { id: nextPanelId(), type: "ErrorHelp", topic: { kind: "general", hint } }
  }
  const networkHint =
    "A proxy, firewall or antivirus program blocking network requests can cause this. " + exception
  const { failures } = actionContext.startup
  const langsFailure = failures.langs
  const cliHint =
    langsFailure instanceof CliVerificationError
      ? `The file '${redactPersonalInfo(langsFailure.cliPath)}' may be damaged, or changed by another program ` +
        "such as an antivirus. Restarting downloads it again. If the download keeps failing: " +
        networkHint
      : networkHint
  return {
    id: nextPanelId(),
    type: "ErrorHelp",
    topic: {
      kind: "startup",
      failures: STARTUP_STEPS.flatMap((step) => {
        const error = failures[step]
        return error
          ? [
              {
                service: SERVICE_NAMES[step],
                error: redactPersonalInfo(
                  error.cause ? `${error.message}: ${error.cause}` : error.message,
                ),
                stack: redactPersonalInfo(error.stack ?? "no stack trace"),
                ...(step === "langs" ? { hint: cliHint } : {}),
                ...(error instanceof BaseError && error.details
                  ? { details: redactPersonalInfo(error.details) }
                  : {}),
              },
            ]
          : []
      }),
    },
  }
}

/** A new help panel on the failure `detailsId` names, or saying it is gone. */
export function errorDetailsPanel(detailsId: string): ErrorHelpPanel {
  return {
    id: nextPanelId(),
    type: "ErrorHelp",
    topic: { kind: "operation", detailsId, details: errorDetails.get(detailsId) ?? null },
  }
}

/** `DegradedStartup.failures` keys, named for the student. */
const SERVICE_NAMES: Record<StartupStep, string> = {
  langs: "the TestMyCode tools",
  resources: "extension files",
  userData: "user data",
}

const STARTUP_STEPS = Object.keys(SERVICE_NAMES) as StartupStep[]
