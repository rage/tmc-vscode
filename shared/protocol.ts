import { z } from "zod"

import { FeedbackQuestionSchema } from "./course"
import {
  CourseHomeActionSchema,
  CourseHomeExerciseActionSchema,
  CourseHomeViewSchema,
} from "./courseHome"
import type { BackendKind } from "./enum"
import { CourseIdentifierSchema, ExerciseIdentifierSchema } from "./enum"
import { SubmissionKind, TestCase, TmcStyleValidationResult } from "./langsSchema"

export const CourseDetailsPanelSchema = z.object({
  id: z.number(),
  type: z.literal("CourseDetails"),
  courseId: CourseIdentifierSchema,
})

export type CourseDetailsPanel = z.infer<typeof CourseDetailsPanelSchema>

// used to define messages that should only be sent to a specific instance of a panel
// for example, a submission's result should only be sent to the ExerciseSubmission
// panel that made it, not to another one that happens to be open
export type TargetPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "id" | "type">

// schema equivalent of `TargetPanel<T>` for the given panel type(s)
export function targetPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.object({
    id: z.number(),
    type: z.literal(types),
  })
}

const BackendKindSchema = z.enum(["tmc", "mooc"]) satisfies z.ZodType<BackendKind>

/** A submission's panel; the host keeps the rest of the submission's state by `id`. */
export const ExerciseSubmissionPanelSchema = z.object({
  id: z.number(),
  type: z.literal("ExerciseSubmission"),
  exerciseId: ExerciseIdentifierSchema,
  backend: BackendKindSchema,
  /** The exercise's display name: a mooc exercise's title, a tmc exercise's slug. */
  exerciseName: z.string(),
  courseTitle: z.string(),
  /** The organization's display name; absent for a tmc course, which stores only its slug. */
  organization: z.string().optional(),
})

export type ExerciseSubmissionPanel = z.infer<typeof ExerciseSubmissionPanelSchema>

const InitializationFailureSchema = z.object({
  /** The service that failed, named for the student. */
  service: z.string(),
  error: z.string(),
  stack: z.string(),
  /** What the student can do about this particular failure. */
  hint: z.string().optional(),
})

/**
 * A command a webview may ask the host to run. The webview cannot pass arguments: the host
 * supplies them, `testMyCode.logLevel` for openSettings and this extension's id for
 * openIssueReporter.
 */
export const RunnableCommandSchema = z.enum([
  "tmc.enrollOnCourse",
  "tmc.logs",
  "tmc.myCourses",
  "tmc.showAiUseProblem",
  "tmc.showMoocLogin",
  "tmc.trustCourseWorkspace",
  "tmc.viewInitializationErrorHelp",
  "tmcTreeView.refreshCourses",
  "workbench.action.restartExtensionHost",
  "workbench.action.openSettings",
  "workbench.action.openIssueReporter",
  "workbench.extensions.action.checkForUpdates",
])

export type RunnableCommand = z.infer<typeof RunnableCommandSchema>

/** A failure's remedy, shown as a button that runs `command`. */
const RemedySchema = z.object({ label: z.string(), command: RunnableCommandSchema })

/** One failure as its Show Details screen explains it; the host keeps it by id. */
export const ErrorDetailsSchema = z.object({
  /** The sentence the failure was reported with. */
  summary: z.string(),
  actions: z.array(RemedySchema),
  /** The error and its causes, outermost first, with the diagnostics each carries. */
  causeChain: z.string(),
  /** ISO timestamp. */
  occurredAt: z.string(),
})

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>

/** What the help screen is about. */
const HelpTopicSchema = z.discriminatedUnion("kind", [
  /** The activation's failures; empty when it had none. */
  z.object({ kind: z.literal("startup"), failures: z.array(InitializationFailureSchema) }),
  /** One failure; `details` is null once the host no longer has it, as after a window reload. */
  z.object({
    kind: z.literal("operation"),
    detailsId: z.string(),
    details: ErrorDetailsSchema.nullable(),
  }),
  /** No failure in particular: what to try when the TestMyCode tools fail. */
  z.object({ kind: z.literal("general"), hint: z.string() }),
])

export type HelpTopic = z.infer<typeof HelpTopicSchema>

/** The help screen: a failed start, one failure's details, or what to try. */
export const ErrorHelpPanelSchema = z.object({
  id: z.number(),
  type: z.literal("ErrorHelp"),
  topic: HelpTopicSchema,
})

export type ErrorHelpPanel = z.infer<typeof ErrorHelpPanelSchema>

/** The courses.mooc.fi login screen; the host runs the login and sends its `LoginView`s. */
export const LoginPanelSchema = z.object({
  id: z.number(),
  type: z.literal("Login"),
  /** Whether a successful login goes on to the add-course screen even when courses are added. */
  isAddingCourse: z.boolean(),
})

export type LoginPanel = z.infer<typeof LoginPanelSchema>

export const AddCoursePanelSchema = z.object({
  id: z.number(),
  type: z.literal("AddCourse"),
})

export type AddCoursePanel = z.infer<typeof AddCoursePanelSchema>

/**
 * Represents a panel that is rendered by the webview.
 *
 * `id`: used to make sure messages are delivered to the correct panels
 */
export const PanelSchema = z.discriminatedUnion("type", [
  CourseDetailsPanelSchema,
  ExerciseSubmissionPanelSchema,
  ErrorHelpPanelSchema,
  LoginPanelSchema,
  AddCoursePanelSchema,
])

export type Panel = z.infer<typeof PanelSchema>

export type PanelType = Panel["type"]

/** A screen the main panel can be reopened on after a window reload. */
export const RestorableRouteSchema = z.discriminatedUnion("type", [
  CourseDetailsPanelSchema.pick({ type: true, courseId: true }),
  z.object({
    type: z.literal("ErrorHelp"),
    kind: z.enum(["startup", "operation", "general"]),
    detailsId: z.string().optional(),
  }),
  AddCoursePanelSchema.pick({ type: true }),
])

export type RestorableRoute = z.infer<typeof RestorableRouteSchema>

/**
 * What a webview saves with `setState`: UI state the host does not hold, such as scroll
 * position, open sections and drafts. VS Code hands it back to the document it reloads a
 * hidden panel with, and to the panel serializer after a window reload.
 */
export const WebviewStateSchema = z.object({
  /** The screen `ui` belongs to, so another screen does not inherit it. */
  screen: z.string(),
  /** The screen to reopen after a window reload; absent for one that is not reopened. */
  route: RestorableRouteSchema.optional(),
  ui: z.record(z.string(), z.unknown()),
})

export type WebviewState = z.infer<typeof WebviewStateSchema>

/**
 * A failure flattened for display in a webview, as the host's `toWebviewError` builds it.
 *
 * The host-to-webview bridge serializes a message as JSON and `Error.message` is
 * non-enumerable, so a live `Error` arrives as `{}`.
 */
export const WebviewErrorSchema = z.object({
  /** The sentence a notification of the same failure would show. */
  message: z.string(),
  /** Names the failure's {@link ErrorDetails} to `showErrorDetails`; absent for a refusal. */
  detailsId: z.string().optional(),
  actions: z.array(RemedySchema).optional(),
})

export type WebviewError = z.infer<typeof WebviewErrorSchema>

const LOG_IN_COMMAND = "tmc.showMoocLogin"

/** Whether logging in is how to get past `error`. */
export function offersLogIn(error: WebviewError | undefined): boolean {
  return error?.actions?.some(({ command }) => command === LOG_IN_COMMAND) ?? false
}

/** `error` without its Log In remedy, for a screen that offers logging in already. */
export function withoutLogIn(error: WebviewError): WebviewError {
  return error.actions
    ? { ...error, actions: error.actions.filter(({ command }) => command !== LOG_IN_COMMAND) }
    : error
}

/** A failure of something a screen started, shown on that screen until dismissed. */
export const ScreenFailureSchema = z.object({
  /** Tells this failure apart from one reported earlier, for a dismissal across reloads. */
  serial: z.number(),
  /** What was being done, e.g. "Failed to download the exercises."; absent for a refusal. */
  title: z.string().optional(),
  /**
   * The operation that failed, as `failuresCleared` names it: a later failure of the same
   * operation replaces this one, and its success clears it.
   */
  operation: z.string(),
  /** `warning` for an action held back rather than failed. */
  tone: z.enum(["error", "warning"]),
  error: WebviewErrorSchema,
})

export type ScreenFailure = z.infer<typeof ScreenFailureSchema>

/** Why a login failed, as far as the login screen words it differently. */
const LoginFailureSchema = z.enum(["denied", "expired", "unreachable", "serverError", "other"])

export type LoginFailure = z.infer<typeof LoginFailureSchema>

/** Where a courses.mooc.fi login is, as the login screen shows it. */
export const LoginViewSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("requestingCode") }),
  z.object({
    phase: z.literal("waiting"),
    userCode: z.string(),
    /** The page the code is entered on, shown for typing it into another browser. */
    verificationUrl: z.string(),
    /** ISO timestamp. */
    expiresAt: z.string(),
  }),
  z.object({ phase: z.literal("failed"), failure: LoginFailureSchema, error: WebviewErrorSchema }),
  z.object({ phase: z.literal("loggedIn") }),
])

export type LoginView = z.infer<typeof LoginViewSchema>

/** What the login screen's buttons ask of the login it shows. */
export const LoginActionSchema = z.enum(["openVerificationPage", "cancel", "tryAgain"])

export type LoginAction = z.infer<typeof LoginActionSchema>

/** A course the add-course screen offers. */
export const CatalogCourseSchema = z.object({
  /** Names the course to `addCourse`, for the panel that listed it only. */
  key: z.string(),
  name: z.string(),
  organization: z.string(),
  description: z.string().optional(),
  isAdded: z.boolean(),
})

export type CatalogCourse = z.infer<typeof CatalogCourseSchema>

/** A tmc.mooc.fi organization, the add-course screen's way into its courses. */
export const CatalogOrganizationSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
})

export type CatalogOrganization = z.infer<typeof CatalogOrganizationSchema>

/** A backend's listing for the add-course screen; `loggedOut` when it needs a login first. */
function catalogListingSchema<T extends z.ZodType>(items: T) {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("loggedOut") }),
    z.object({ kind: z.literal("listed"), items: z.array(items) }),
  ])
}

export const MoocCatalogSchema = catalogListingSchema(CatalogCourseSchema)

export type MoocCatalog = z.infer<typeof MoocCatalogSchema>

export const TmcOrganizationsSchema = catalogListingSchema(CatalogOrganizationSchema)

export type TmcOrganizations = z.infer<typeof TmcOrganizationsSchema>

/** Where a submission is, from sending it to its final grade. */
const SubmissionPhaseSchema = z.enum([
  "uploading",
  "grading",
  "finished",
  // The host stopped waiting before the backend finished grading.
  "timedOut",
  "failed",
  "manualReview",
  // No submission is shown: the exercise as the course last reported it.
  "standing",
  // Every test passed in the student's own run, which the backend has not seen.
  "testedLocally",
])

/**
 * Everything the ExerciseSubmission panel shows about one submission, from either backend.
 *
 * Built on the host by `src/panels/submissionView.ts`; the panel renders it without knowing
 * which backend answered.
 */
export const SubmissionViewSchema = z.object({
  phase: SubmissionPhaseSchema,
  headline: z.string(),
  /** How the headline reads at a glance; `warning` is a partial score or an unchecked grading. */
  tone: z.enum(["progress", "passed", "warning", "failed", "info"]),
  /** What the phase means for the student, where the headline does not say it. */
  explanation: z.string().optional(),
  /** The teacher review the exercise awaits, as a sentence; for a finished grading only. */
  pendingReview: z.string().optional(),
  /** The backend's completion estimate, 0..1; absent while it has none, as for mooc grading. */
  progressFraction: z.number().optional(),
  /** The backend's progress messages, oldest first; only while uploading or grading. */
  progressSteps: z.array(z.string()),
  /** In the exercise's own unit; `given` may be fractional. */
  points: z.object({ given: z.number(), max: z.number() }).optional(),
  /** The grader's feedback, shown as-is. */
  feedbackText: z.string().optional(),
  /** Why the submission failed, when the backend or the extension said. */
  error: WebviewErrorSchema.optional(),
  /** What the server's compiler or test run printed when it produced no test results. */
  serverOutput: z.string().optional(),
  testCases: z.array(TestCase),
  validations: TmcStyleValidationResult.optional(),
  valgrind: z.string().optional(),
  solutionUrl: z.string().optional(),
  /** The submission's page on the backend's site. */
  submissionUrl: z.string().optional(),
  /** Whether `keepWaitingForGrading` can pick the wait up again for this submission. */
  canKeepWaiting: z.boolean(),
  /** The teachers' feedback questions, answered once through `sendFeedback`. */
  feedback: z
    .object({ questions: z.array(FeedbackQuestionSchema), isSent: z.boolean() })
    .optional(),
  /** Whether to offer sending the exercise to the backend's paste service for help. */
  canPaste: z.boolean(),
  /** The exercise counts as passed now; absent means not, or not known yet. */
  isExercisePassed: z.boolean().optional(),
  /** The exercise to go on to, offered once this one is passed. */
  nextExercise: z.object({ name: z.string() }).optional(),
  /**
   * Where the exercise is now, which can change while the view is shown: `notOnDisk` once its
   * files are gone, `removed` once its course no longer lists it. Absent means on disk.
   */
  exerciseState: z.enum(["notOnDisk", "removed"]).optional(),
  /** Why the backend would refuse another submission now, as a sentence; Submit is then not offered. */
  submitRefusal: z.string().optional(),
  /** The tries left on the exercise as it stands now; absent when unlimited. */
  triesLeft: z.number().optional(),
  /** Submitting takes a login first, which Submit then offers as Log In to Submit. */
  isLoggedOut: z.boolean().optional(),
})

export type SubmissionView = z.infer<typeof SubmissionViewSchema>

/** One earlier submission, help request or backup of an exercise, as its History lists it. */
export const SubmissionHistoryEntrySchema = z.object({
  /** Names the entry to `restoreSubmission`, for the panel that listed it only. */
  key: z.string(),
  /** ISO timestamp. */
  createdAt: z.string(),
  /** `createdAt` in the student's language. */
  dateLabel: z.string(),
  kind: SubmissionKind,
  /** In the exercise's own unit; absent while ungraded. */
  points: z.object({ given: z.number(), max: z.number() }).optional(),
  /** The outcome in a few words, e.g. "Some tests failed" or "Not graded". */
  status: z.string(),
  /** All tests passed on tmc; full points on courses.mooc.fi. */
  isPassed: z.boolean(),
  /** The newest graded submission, which a fresh download restores. */
  isNewestGraded: z.boolean(),
  /** A help request whose link has been shared. */
  isShared: z.boolean(),
})

export type SubmissionHistoryEntry = z.infer<typeof SubmissionHistoryEntrySchema>

/** What `restoreSubmission` did; `cancelled` when the student said no in the confirmation. */
const RestoreOutcomeSchema = z.enum(["restored", "cancelled", "nothingToDownload"])

export type RestoreOutcome = z.infer<typeof RestoreOutcomeSchema>

/** A part of the ExerciseSubmission panel a command can open and move the focus to. */
export const ExerciseSectionSchema = z.enum(["history", "getHelp"])

export type ExerciseSection = z.infer<typeof ExerciseSectionSchema>

/** One answer to a TMC submission's feedback question. */
const FeedbackAnswerSchema = z.object({ questionId: z.number(), answer: z.string() })

export type FeedbackAnswer = z.infer<typeof FeedbackAnswerSchema>

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export const ExtensionToWebviewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setPanel"),
    panel: PanelSchema,
  }),
  // The course a CourseDetails panel shows, whenever anything it shows changes.
  z.object({
    type: z.literal("setCourseHomeView"),
    target: targetPanelSchema("CourseDetails"),
    view: CourseHomeViewSchema,
  }),
  // The whole view each time: the latest one is what a reloaded panel is sent again.
  z.object({
    type: z.literal("submissionView"),
    target: targetPanelSchema("ExerciseSubmission"),
    view: SubmissionViewSchema,
  }),
  // Opens a section of the panel for a command the student ran; `serial` tells a new request
  // from the same one resent after a reload, which must not paste again.
  z.object({
    type: z.literal("openExerciseSection"),
    target: targetPanelSchema("ExerciseSubmission"),
    section: ExerciseSectionSchema,
    serial: z.number(),
    shouldPaste: z.boolean(),
  }),
  // An action the screen started failed, or one of its buttons could not run.
  z.object({
    type: z.literal("operationFailed"),
    target: targetPanelSchema("CourseDetails", "ExerciseSubmission"),
    failure: ScreenFailureSchema,
  }),
  // The failures shown are out of date: those of `operation`, or every one without it.
  z.object({
    type: z.literal("failuresCleared"),
    target: targetPanelSchema("CourseDetails", "ExerciseSubmission"),
    operation: z.string().optional(),
  }),
  // The login a Login panel shows, whenever it moves on.
  z.object({
    type: z.literal("loginView"),
    target: targetPanelSchema("Login"),
    view: LoginViewSchema,
  }),
  // The one answer to a request, see `RequestMessage`.
  z.object({
    type: z.literal("reply"),
    target: targetPanelSchema(
      "CourseDetails",
      "ExerciseSubmission",
      "ErrorHelp",
      "Login",
      "AddCourse",
    ),
    requestId: z.number(),
    outcome: z.discriminatedUnion("ok", [
      // `value` is checked against `ReplyValueSchemas` by the side that knows the request.
      z.object({ ok: z.literal(true), value: z.unknown().optional() }),
      z.object({ ok: z.literal(false), error: WebviewErrorSchema }),
    ]),
  }),
])

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export type ExtensionToWebview = z.infer<typeof ExtensionToWebviewSchema>

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export const WebviewToExtensionSchema = z.discriminatedUnion("type", [
  // a reloaded webview has lost whatever was already posted to it; asks the
  // extension to resend the current panel
  z.object({
    type: z.literal("ready"),
  }),
  // `sourcePanel` names the requesting panel; any other panel fields are stripped unread.
  z.object({
    type: z.literal("requestCourseDetailsData"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("CourseDetails").extend({ courseId: CourseIdentifierSchema }),
  }),
  z.object({
    type: z.literal("openCourseWorkspace"),
    // The id, not the slug: the slug names a file the extension writes and opens, so
    // the webview must not be the one choosing it.
    courseId: CourseIdentifierSchema,
  }),
  // Acts on the course the named panel shows.
  z.object({
    type: z.literal("courseAction"),
    sourcePanel: targetPanelSchema("CourseDetails"),
    action: CourseHomeActionSchema,
  }),
  // Acts on one exercise of the course the named panel shows.
  z.object({
    type: z.literal("courseExerciseAction"),
    sourcePanel: targetPanelSchema("CourseDetails"),
    exerciseId: ExerciseIdentifierSchema,
    action: CourseHomeExerciseActionSchema,
  }),
  // Refreshes the course the named panel shows.
  z.object({
    type: z.literal("refreshCourseDetails"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("CourseDetails"),
  }),
  z.object({
    type: z.literal("closeSidePanel"),
  }),
  // Pastes the exercise the named panel shows; a path from the webview would be one the
  // webview chose.
  z.object({
    type: z.literal("pasteExercise"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
  }),
  // Lists the earlier submissions of the exercise the named panel shows.
  z.object({
    type: z.literal("requestSubmissionHistory"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
  }),
  // Restores an entry the named panel's last history listed, after the host's confirmation.
  z.object({
    type: z.literal("restoreSubmission"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
    key: z.string(),
  }),
  // Waits again for the grading of the submission the named panel shows, after the host
  // stopped waiting; progress and the outcome arrive as `submissionView`.
  z.object({
    type: z.literal("keepWaitingForGrading"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
  }),
  // Runs an exercise command on the exercise the named panel shows.
  z.object({
    type: z.literal("exerciseAction"),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
    action: z.enum(["runTests", "submit", "logInToSubmit", "openNextExercise", "openExercise"]),
  }),
  z.object({
    type: z.literal("sendFeedback"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission"),
    answers: z.array(FeedbackAnswerSchema),
  }),
  z.object({
    type: z.literal("copyToClipboard"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ExerciseSubmission", "Login", "ErrorHelp"),
    text: z.string(),
  }),
  // Opens the help screen on the failure an error notice named, beside the screen it is on.
  z.object({
    type: z.literal("showErrorDetails"),
    detailsId: z.string(),
  }),
  // The latest log lines, for the help screen.
  z.object({
    type: z.literal("requestLogTail"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("ErrorHelp"),
  }),
  // Acts on the login the named panel shows.
  z.object({
    type: z.literal("loginAction"),
    sourcePanel: targetPanelSchema("Login"),
    action: LoginActionSchema,
  }),
  // The courses.mooc.fi courses the student is enrolled in.
  z.object({
    type: z.literal("requestMoocCatalog"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("AddCourse"),
  }),
  z.object({
    type: z.literal("requestTmcOrganizations"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("AddCourse"),
  }),
  // The courses of a tmc.mooc.fi organization the named panel's last listing named.
  z.object({
    type: z.literal("requestTmcCourses"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("AddCourse"),
    organizationSlug: z.string(),
  }),
  // Adds a course the named panel listed, unless it already is, and opens its course home.
  z.object({
    type: z.literal("addCourse"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("AddCourse"),
    key: z.string(),
  }),
  z.object({
    type: z.literal("addCourseAction"),
    sourcePanel: targetPanelSchema("AddCourse"),
    action: z.enum(["logIn", "findCourse"]),
  }),
  z.object({
    type: z.literal("openLinkInBrowser"),
    // Most senders carry a backend-supplied string; the handler additionally restricts
    // the scheme, which this does not.
    url: z.url(),
  }),
  // an uncaught webview error, for the extension log
  z.object({
    type: z.literal("webviewError"),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({
    type: z.literal("runCommand"),
    command: RunnableCommandSchema,
  }),
])

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export type WebviewToExtension = z.infer<typeof WebviewToExtensionSchema>

/**
 * A webview message that expects an outcome.
 *
 * The host answers every one with exactly one `reply` carrying the same `requestId`, addressed
 * to `sourcePanel`, whether the request succeeded, failed or threw.
 */
export type RequestMessage = Extract<WebviewToExtension, { requestId: number }>

export type RequestType = RequestMessage["type"]

/** What a successful `reply` carries, per request type. */
export const ReplyValueSchemas = {
  requestCourseDetailsData: CourseHomeViewSchema,
  refreshCourseDetails: CourseHomeViewSchema,
  // `isReused` when the code is unchanged since the paste that made `link`
  pasteExercise: z.object({ link: z.string(), isReused: z.boolean() }),
  requestSubmissionHistory: z.array(SubmissionHistoryEntrySchema),
  restoreSubmission: RestoreOutcomeSchema,
  keepWaitingForGrading: z.undefined(),
  sendFeedback: z.undefined(),
  copyToClipboard: z.undefined(),
  requestLogTail: z.string(),
  requestMoocCatalog: MoocCatalogSchema,
  requestTmcOrganizations: TmcOrganizationsSchema,
  requestTmcCourses: z.array(CatalogCourseSchema),
  addCourse: z.undefined(),
} satisfies Record<RequestType, z.ZodType>

export type ReplyValue<K extends RequestType> = z.infer<(typeof ReplyValueSchemas)[K]>

/** How a request ended, as its `reply` says. */
export type ReplyOutcome<K extends RequestType> =
  | { ok: true; value: ReplyValue<K> }
  | { ok: false; error: WebviewError }

// The messages a panel of type T can receive: those whose target admits T.
export type Targeted<M, T extends PanelType> = Exclude<
  M,
  { target: { type: Exclude<PanelType, T> } }
>
