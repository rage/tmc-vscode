import { z } from "zod"

import { FeedbackQuestionSchema, LocalCourseDataSchema, LocalCourseExerciseSchema } from "./course"
import { CourseIdentifierSchema } from "./enum"
import { BaseError } from "./errors"
import { TestCase, TmcStyleValidationResult } from "./langsSchema"

export const AppPanelSchema = z.object({
  id: z.number(),
  type: z.literal("App"),
})

export type AppPanel = z.infer<typeof AppPanelSchema>

export const CourseDetailsPanelSchema = z.object({
  id: z.number(),
  type: z.literal("CourseDetails"),
  courseId: CourseIdentifierSchema,
  course: LocalCourseDataSchema.optional(),
})

export type CourseDetailsPanel = z.infer<typeof CourseDetailsPanelSchema>

// defined by hand (rather than as `Panel["type"]`) so that
// `targetPanelSchema`/`broadcastPanelSchema` can be used inside the panel schemas
// themselves without creating a circular type dependency;
// the `_panelTypesMatch` assertion below `Panel` keeps this in sync with `PanelSchema`
export type PanelType = "App" | "CourseDetails" | "ExerciseSubmission" | "InitializationErrorHelp"

// used to define messages that should only be sent to a specific instance of a panel
// for example, a submission's result should only be sent to the ExerciseSubmission
// panel that made it, not to another one that happens to be open
export type TargetPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "id" | "type">

/**
 * Addresses `panel` without carrying its state along.
 *
 * A panel object holds the whole course and its exercises; a message's `target` is read
 * for its `id` and `type` alone, and the rest is serialized through `postMessage` on
 * every send for nothing.
 */
export function panelTarget<T extends { id: number; type: PanelType }>(
  panel: T,
): { id: number; type: T["type"] } {
  return { id: panel.id, type: panel.type }
}

// schema equivalent of `TargetPanel<T>` for the given panel type(s)
export function targetPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.object({
    id: z.number(),
    type: z.literal(types),
  })
}

// schema equivalent of a broadcast target (no id) for the given panel type(s)
export function broadcastPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.object({
    type: z.literal(types),
  })
}

// stricter variant of `targetPanelSchema`, rejecting unknown keys.
//
// Used only for the *webview → extension host* direction, where the webview never needs
// to send more than `{id, type}`: a whole panel posted by mistake, with every course and
// exercise it holds, is rejected instead of being serialized and validated for nothing.
//
// Deliberately NOT used for `ExtensionToWebviewSchema`'s `target` fields: a
// broadcast target there may carry an `id` on top of the `type` it declares,
// which narrows the broadcast to the one panel that asked, and the listener
// honours it.
function strictTargetPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.strictObject({
    id: z.number(),
    type: z.literal(types),
  })
}

export const ExerciseSubmissionPanelSchema = z.object({
  id: z.number(),
  type: z.literal("ExerciseSubmission"),
  course: LocalCourseDataSchema,
  exercise: LocalCourseExerciseSchema,
})

export type ExerciseSubmissionPanel = z.infer<typeof ExerciseSubmissionPanelSchema>

export const InitializationErrorHelpPanelSchema = z.object({
  id: z.number(),
  type: z.literal("InitializationErrorHelp"),
})

export type InitializationErrorHelpPanel = z.infer<typeof InitializationErrorHelpPanelSchema>

/**
 * Represents a panel that is rendered by the webview.
 *
 * `id`: used to make sure messages are delivered to the correct panels
 */
export const PanelSchema = z.discriminatedUnion("type", [
  AppPanelSchema,
  CourseDetailsPanelSchema,
  ExerciseSubmissionPanelSchema,
  InitializationErrorHelpPanelSchema,
])

export type Panel = z.infer<typeof PanelSchema>

// compile-time assertion that the hand-written `PanelType` stays in sync with `PanelSchema`
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type _panelTypesMatch = Equal<Panel["type"], PanelType> extends true ? true : never

const _panelTypesMatch: _panelTypesMatch = true

/**
 * What a webview saves with `setState`: UI state the host does not hold, such as scroll
 * position, open sections and drafts. VS Code hands it back to the document it reloads a
 * hidden panel with.
 */
export const WebviewStateSchema = z.object({
  /** The screen `ui` belongs to, so another screen does not inherit it. */
  screen: z.string(),
  ui: z.record(z.string(), z.unknown()),
})

export type WebviewState = z.infer<typeof WebviewStateSchema>

/**
 * A failure flattened for display in a webview.
 *
 * The host-to-webview bridge serializes a message as JSON and `Error.message` is
 * non-enumerable, so a live `Error` arrives as `{}`. Build one with
 * {@link toWebviewError} at the send site.
 */
export const WebviewErrorSchema = z.object({
  message: z.string(),
  details: z.string().optional(),
})

export type WebviewError = z.infer<typeof WebviewErrorSchema>

/** Flattens anything thrown into a {@link WebviewError}. */
export function toWebviewError(error: unknown): WebviewError {
  const base = error instanceof BaseError ? error : undefined
  const message = error instanceof Error ? error.message : String(error)
  return {
    message: message || "Unknown error",
    ...(base?.details ? { details: base.details } : {}),
  }
}

/** Where a submission is, from sending it to its final grade. */
const SubmissionPhaseSchema = z.enum([
  "uploading",
  "grading",
  "finished",
  // The host stopped waiting before the backend finished grading.
  "timedOut",
  "failed",
  "manualReview",
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
  /** What the phase means for the student, where the headline does not say it. */
  explanation: z.string().optional(),
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
  testCases: z.array(TestCase),
  validations: TmcStyleValidationResult.optional(),
  valgrind: z.string().optional(),
  solutionUrl: z.string().optional(),
  /** The submission's page on the backend's site. */
  submissionUrl: z.string().optional(),
  /** Whether `keepWaitingForGrading` can pick the wait up again for this submission. */
  canKeepWaiting: z.boolean(),
  /** The teachers' feedback questions, answered at `answerUrl` through `sendFeedback`. */
  feedback: z
    .object({ answerUrl: z.string(), questions: z.array(FeedbackQuestionSchema) })
    .optional(),
  /** Whether to offer sending the exercise to the backend's paste service for help. */
  canPaste: z.boolean(),
})

export type SubmissionView = z.infer<typeof SubmissionViewSchema>

const initializationErrorSchema = z
  .object({
    error: z.string(),
    stack: z.string(),
  })
  .nullable()

export const InitializationErrorsSchema = z.object({
  cliFolder: z.string(),
  initializationErrors: z.object({
    tmc: initializationErrorSchema,
    userData: initializationErrorSchema,
    workspaceManager: initializationErrorSchema,
    exerciseDecorationProvider: initializationErrorSchema,
    resources: initializationErrorSchema,
  }),
})

export type InitializationErrors = z.infer<typeof InitializationErrorsSchema>

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export const ExtensionToWebviewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setPanel"),
    target: targetPanelSchema("App"),
    panel: PanelSchema,
  }),
  z.object({
    type: z.literal("setCourseData"),
    target: targetPanelSchema("CourseDetails"),
    courseData: LocalCourseDataSchema,
  }),
  z.object({
    type: z.literal("setCourseDisabledStatus"),
    target: broadcastPanelSchema("CourseDetails"),
    courseId: CourseIdentifierSchema,
    disabled: z.boolean(),
  }),
  // The whole view each time: the latest one is what a reloaded panel is sent again.
  z.object({
    type: z.literal("submissionView"),
    target: targetPanelSchema("ExerciseSubmission"),
    view: SubmissionViewSchema,
  }),
  // The one answer to a request, see `RequestMessage`.
  z.object({
    type: z.literal("reply"),
    target: targetPanelSchema("CourseDetails", "ExerciseSubmission", "InitializationErrorHelp"),
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
  z.object({
    type: z.literal("refreshCourseDetails"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("CourseDetails"),
    id: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("closeSidePanel"),
  }),
  // Pastes the exercise the named panel shows; a path from the webview would be one the
  // webview chose.
  z.object({
    type: z.literal("pasteExercise"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("ExerciseSubmission"),
  }),
  // Waits again for the grading of the submission the named panel shows, after the host
  // stopped waiting; progress and the outcome arrive as `submissionView`.
  z.object({
    type: z.literal("keepWaitingForGrading"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("ExerciseSubmission"),
  }),
  z.object({
    type: z.literal("sendFeedback"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("ExerciseSubmission"),
    feedbackAnswerUrl: z.url(),
    answers: z.array(z.object({ questionId: z.number(), answer: z.string() })),
  }),
  z.object({
    type: z.literal("copyToClipboard"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("ExerciseSubmission"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("openLinkInBrowser"),
    // Most senders carry a backend-supplied string; the handler additionally restricts
    // the scheme, which this does not.
    url: z.url(),
  }),
  z.object({
    type: z.literal("requestInitializationErrors"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("InitializationErrorHelp"),
  }),
  // an uncaught webview error, for the extension log
  z.object({
    type: z.literal("webviewError"),
    message: z.string(),
    stack: z.string().optional(),
  }),
  z.object({
    type: z.literal("runCommand"),
    // The webview cannot pass arguments: the host supplies them, `testMyCode.logLevel` for
    // openSettings and this extension's id for openIssueReporter.
    command: z.enum([
      "tmc.logs",
      "tmc.myCourses",
      "tmc.showMoocLogin",
      "workbench.action.restartExtensionHost",
      "workbench.action.openSettings",
      "workbench.action.openIssueReporter",
    ]),
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
  requestCourseDetailsData: z.undefined(),
  refreshCourseDetails: z.undefined(),
  // the paste link
  pasteExercise: z.string(),
  keepWaitingForGrading: z.undefined(),
  sendFeedback: z.undefined(),
  copyToClipboard: z.undefined(),
  requestInitializationErrors: InitializationErrorsSchema,
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
