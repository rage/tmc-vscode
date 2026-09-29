import { z } from "zod"

import {
  ExerciseGroupSchema,
  ExerciseStatusSchema,
  FeedbackQuestionSchema,
  LocalCourseDataSchema,
  LocalCourseExerciseSchema,
} from "./course"
import { CourseIdentifierSchema, ExerciseIdentifierSchema } from "./enum"
import { BaseError } from "./errors"
import { ExerciseTaskSubmissionStatus, SubmissionFinished } from "./langsSchema"

export const AppPanelSchema = z.object({
  id: z.number(),
  type: z.literal("App"),
})

export type AppPanel = z.infer<typeof AppPanelSchema>

export const MyCoursesPanelSchema = z.object({
  id: z.number(),
  type: z.literal("MyCourses"),
  // matches the `setMyCourses` message, which carries the user's local course data
  courses: z.array(LocalCourseDataSchema).optional(),
  tmcDataPath: z.string().optional(),
  tmcDataSize: z.string().optional(),
})

export type MyCoursesPanel = z.infer<typeof MyCoursesPanelSchema>

export const CourseDetailsPanelSchema = z.object({
  id: z.number(),
  type: z.literal("CourseDetails"),
  courseId: CourseIdentifierSchema,
  course: LocalCourseDataSchema.optional(),
  offlineMode: z.boolean().optional(),
  updateableExercises: z.array(ExerciseIdentifierSchema).optional(),
  // undefined until the exercise groups have been received from the extension host
  exerciseGroups: z.array(ExerciseGroupSchema).optional(),
  exerciseStatuses: z.object({
    tmc: z.record(z.coerce.number(), ExerciseStatusSchema),
    mooc: z.record(z.string(), ExerciseStatusSchema),
  }),
})

export type CourseDetailsPanel = z.infer<typeof CourseDetailsPanelSchema>

// defined by hand (rather than as `Panel["type"]`) so that
// `targetPanelSchema`/`broadcastPanelSchema` can be used inside the panel schemas
// themselves without creating a circular type dependency;
// the `_panelTypesMatch` assertion below `Panel` keeps this in sync with `PanelSchema`
export type PanelType =
  | "App"
  | "MyCourses"
  | "CourseDetails"
  | "ExerciseSubmission"
  | "MoocLogin"
  | "InitializationErrorHelp"

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

export const MoocLoginPanelSchema = z.object({
  id: z.number(),
  type: z.literal("MoocLogin"),
})

export type MoocLoginPanel = z.infer<typeof MoocLoginPanelSchema>

/**
 * Represents a panel that is rendered by the webview.
 *
 * `id`: used to make sure messages are delivered to the correct panels
 */
export const PanelSchema = z.discriminatedUnion("type", [
  AppPanelSchema,
  MyCoursesPanelSchema,
  CourseDetailsPanelSchema,
  ExerciseSubmissionPanelSchema,
  MoocLoginPanelSchema,
  InitializationErrorHelpPanelSchema,
])

export type Panel = z.infer<typeof PanelSchema>

// compile-time assertion that the hand-written `PanelType` stays in sync with `PanelSchema`
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type _panelTypesMatch = Equal<Panel["type"], PanelType> extends true ? true : never

const _panelTypesMatch: _panelTypesMatch = true

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
    type: z.literal("setMyCourses"),
    target: broadcastPanelSchema("MyCourses"),
    courses: z.array(LocalCourseDataSchema),
  }),
  z.object({
    type: z.literal("setTmcDataPath"),
    target: broadcastPanelSchema("MyCourses"),
    tmcDataPath: z.string(),
  }),
  z.object({
    type: z.literal("setTmcDataSize"),
    target: targetPanelSchema("MyCourses"),
    tmcDataSize: z.string(),
  }),
  z.object({
    type: z.literal("setCourseData"),
    target: targetPanelSchema("CourseDetails"),
    courseData: LocalCourseDataSchema,
  }),
  z.object({
    type: z.literal("setCourseGroups"),
    target: targetPanelSchema("CourseDetails"),
    offlineMode: z.boolean(),
    exerciseGroups: z.array(ExerciseGroupSchema),
  }),
  z.object({
    type: z.literal("setCourseDisabledStatus"),
    target: broadcastPanelSchema("MyCourses", "CourseDetails"),
    courseId: CourseIdentifierSchema,
    disabled: z.boolean(),
  }),
  z.object({
    type: z.literal("exerciseStatusChange"),
    target: broadcastPanelSchema("CourseDetails"),
    // Scopes the broadcast to the CourseDetails panel showing this course (main/side can differ).
    courseId: CourseIdentifierSchema,
    exerciseId: ExerciseIdentifierSchema,
    status: ExerciseStatusSchema,
  }),
  // The whole course's statuses in one message. `exerciseStatusChange` stays for genuine
  // per-exercise deltas; a course opening would otherwise post one message per exercise.
  z.object({
    type: z.literal("setExerciseStatuses"),
    target: broadcastPanelSchema("CourseDetails"),
    // Scopes the broadcast to the CourseDetails panel showing this course (main/side can differ).
    courseId: CourseIdentifierSchema,
    statuses: z.array(z.tuple([ExerciseIdentifierSchema, ExerciseStatusSchema])),
  }),
  z.object({
    type: z.literal("setUpdateables"),
    target: broadcastPanelSchema("CourseDetails"),
    // Scopes the broadcast to the CourseDetails panel showing this course (main/side can differ).
    courseId: CourseIdentifierSchema,
    exerciseIds: z.array(ExerciseIdentifierSchema),
  }),
  z.object({
    type: z.literal("submissionStatusUrl"),
    target: targetPanelSchema("ExerciseSubmission"),
    url: z.string(),
  }),
  z.object({
    type: z.literal("submissionStatusUpdate"),
    target: targetPanelSchema("ExerciseSubmission"),
    // completion as a 0..1 fraction, the unit every progress value in the extension uses
    fraction: z.number(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("submissionResult"),
    target: targetPanelSchema("ExerciseSubmission"),
    result: SubmissionFinished,
    questions: z.array(FeedbackQuestionSchema),
  }),
  // Mooc grading has no per-test breakdown or feedback questions, so its result
  // is a reduced shape (overall grading progress, score, feedback text) posted
  // through a separate message rather than reusing the TMC `submissionResult`.
  z.object({
    type: z.literal("moocSubmissionResult"),
    target: targetPanelSchema("ExerciseSubmission"),
    result: ExerciseTaskSubmissionStatus,
  }),
  z.object({
    type: z.literal("submissionStatusError"),
    target: targetPanelSchema("ExerciseSubmission"),
    error: WebviewErrorSchema,
  }),
  z.object({
    type: z.literal("setNewExercises"),
    target: broadcastPanelSchema("MyCourses"),
    courseId: CourseIdentifierSchema,
    exerciseIds: z.array(ExerciseIdentifierSchema),
  }),
  // Device-authorization info the CLI emits before blocking on polling; snake_case CLI fields mapped to camelCase.
  z.object({
    type: z.literal("moocDeviceCode"),
    target: targetPanelSchema("MoocLogin"),
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string().nullable(),
    expiresIn: z.number(),
    interval: z.number(),
  }),
  // The one answer to a request, see `RequestMessage`.
  z.object({
    type: z.literal("reply"),
    target: targetPanelSchema(
      "MyCourses",
      "CourseDetails",
      "ExerciseSubmission",
      "MoocLogin",
      "InitializationErrorHelp",
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

// helper type for messages from the extension to a specific panel
export type TargetedExtensionToWebview<T extends PanelType> = Targeted<ExtensionToWebview, T>

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
    type: z.literal("requestMyCoursesData"),
    requestId: z.number(),
    sourcePanel: targetPanelSchema("MyCourses"),
  }),
  z.object({
    type: z.literal("removeCourse"),
    id: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("openCourseWorkspace"),
    // The id, not the slug: the slug names a file the extension writes and opens, so
    // the webview must not be the one choosing it.
    courseId: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("downloadExercises"),
    ids: z.array(ExerciseIdentifierSchema),
    courseId: CourseIdentifierSchema,
    mode: z.enum(["download", "update"]),
  }),
  z.object({
    type: z.literal("clearNewExercises"),
    courseId: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("addNewCourse"),
  }),
  z.object({
    type: z.literal("changeTmcDataPath"),
  }),
  z.object({
    type: z.literal("openCourseDetails"),
    courseId: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("openMyCourses"),
  }),
  z.object({
    type: z.literal("refreshCourseDetails"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("CourseDetails"),
    id: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("openExercises"),
    ids: z.array(ExerciseIdentifierSchema),
    courseId: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("closeExercises"),
    ids: z.array(ExerciseIdentifierSchema),
    courseId: CourseIdentifierSchema,
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
  // Posted on MoocLogin mount; starts the CLI device-flow login. The code is streamed back as
  // `moocDeviceCode`, and the reply comes once the login is over.
  z.object({
    type: z.literal("moocLogin"),
    requestId: z.number(),
    sourcePanel: strictTargetPanelSchema("MoocLogin"),
  }),
  z.object({
    // Kills the in-progress device-flow login CLI process, keyed by panel id.
    type: z.literal("cancelMoocLogin"),
    sourcePanel: strictTargetPanelSchema("MoocLogin"),
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
  requestMyCoursesData: z.undefined(),
  refreshCourseDetails: z.undefined(),
  // the paste link
  pasteExercise: z.string(),
  sendFeedback: z.undefined(),
  copyToClipboard: z.undefined(),
  moocLogin: z.undefined(),
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
