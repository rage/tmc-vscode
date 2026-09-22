import type { Uri } from "vscode"
import { z } from "zod"

import {
  ExerciseGroupSchema,
  ExerciseStatusSchema,
  FeedbackQuestionSchema,
  LocalCourseDataSchema,
  LocalCourseExerciseSchema,
  TestResultDataSchema,
} from "./course"
import { CourseIdentifierSchema, ExerciseIdentifierSchema } from "./enum"
import { BaseError } from "./errors"
import { ExerciseTaskSubmissionStatus, SubmissionFinished } from "./langsSchema"

export const AppPanelSchema = z.object({
  id: z.number(),
  type: z.literal("App"),
})

export type AppPanel = z.infer<typeof AppPanelSchema>

export const WelcomePanelSchema = z.object({
  id: z.number(),
  type: z.literal("Welcome"),
  version: z.string().optional(),
})

export type WelcomePanel = z.infer<typeof WelcomePanelSchema>

export const MyCoursesPanelSchema = z.object({
  id: z.number(),
  type: z.literal("MyCourses"),
  // matches the `setMyCourses` message, which carries the user's local course data
  courses: z.array(LocalCourseDataSchema).optional(),
  tmcDataPath: z.string().optional(),
  tmcDataSize: z.string().optional(),
  // keyed by `CourseIdentifier.toString` (course id for tmc, instance id for mooc)
  courseDeadlines: z.record(z.string(), z.string()),
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
  | "Welcome"
  | "MyCourses"
  | "CourseDetails"
  | "ExerciseTests"
  | "ExerciseSubmission"
  | "MoocLogin"
  | "InitializationErrorHelp"

// used to define messages that should only be sent to a specific instance of a panel
// for example, an exercise's test results should only be sent to the ExerciseTests
// panel that started the run, not to another one that happens to be open
export type TargetPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "id" | "type">

// used to define messages that should be sent to any instance of a given panel type
// for example, a change in an exercise's status should be sent to all panels that display the status
export type BroadcastPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "type">

/**
 * Addresses `panel` without carrying its state along.
 *
 * A panel object holds the whole course and its exercises; a message's `target` is read
 * for its `id` and `type` alone, and the rest is serialized through `postMessage` on
 * every send for nothing.
 */
export function panelTarget<T extends Panel>(panel: T): { id: number; type: T["type"] } {
  return { id: panel.id, type: panel.type }
}

// schema equivalent of `TargetPanel<T>` for the given panel type(s)
export function targetPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.object({
    id: z.number(),
    type: z.literal(types),
  })
}

// schema equivalent of `BroadcastPanel<T>` for the given panel type(s)
export function broadcastPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.object({
    type: z.literal(types),
  })
}

// stricter variant of `targetPanelSchema`, rejecting unknown keys.
//
// Used only for the *webview → extension host* direction (`sourcePanel` fields
// in `WebviewToExtensionSchema`): the webview should never legitimately need to
// send more than `{id, type}` there, so this acts as a guard against
// accidentally posting a whole (potentially Svelte 5 `$state`-proxied) panel
// object, which would otherwise fail with an opaque `DataCloneError` instead of
// failing loudly.
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

export const ExerciseTestsPanelSchema = z.object({
  id: z.number(),
  type: z.literal("ExerciseTests"),
  course: LocalCourseDataSchema,
  exercise: LocalCourseExerciseSchema,
  // `Uri` does not survive `postMessage` serialization as a class instance,
  // so it is passed through without validation
  exerciseUri: z.custom<Uri>(),
  testRunId: z.number(),
})

export type ExerciseTestsPanel = z.infer<typeof ExerciseTestsPanelSchema>

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
  WelcomePanelSchema,
  MyCoursesPanelSchema,
  CourseDetailsPanelSchema,
  ExerciseTestsPanelSchema,
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
    type: z.literal("setWelcomeData"),
    target: targetPanelSchema("Welcome"),
    version: z.string(),
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
    type: z.literal("testResults"),
    target: targetPanelSchema("ExerciseTests"),
    testResults: TestResultDataSchema,
  }),
  z.object({
    type: z.literal("testError"),
    target: targetPanelSchema("ExerciseTests"),
    error: WebviewErrorSchema,
  }),
  // the submit never started, so the panel it would have opened never appears;
  // tells the ExerciseTests panel still on screen to re-enable its buttons
  z.object({
    type: z.literal("submitFailed"),
    target: broadcastPanelSchema("ExerciseTests"),
  }),
  z.object({
    type: z.literal("pasteResult"),
    target: targetPanelSchema("ExerciseTests", "ExerciseSubmission"),
    pasteLink: z.string(),
  }),
  z.object({
    type: z.literal("pasteError"),
    target: targetPanelSchema("ExerciseTests", "ExerciseSubmission"),
    error: z.string(),
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
  // The one answer a `request*Data` message gets, naming the request it answers so a
  // panel ignores the answer to one it has already given up on. Every path out of a
  // request handler has to send it, or the panel waits out its own timeout instead.
  z.object({
    type: z.literal("panelDataResult"),
    target: targetPanelSchema("Welcome", "MyCourses", "CourseDetails"),
    requestId: z.number(),
    // absent once the data itself has been sent
    error: WebviewErrorSchema.optional(),
  }),
  z.object({
    type: z.literal("setNewExercises"),
    target: broadcastPanelSchema("MyCourses"),
    courseId: CourseIdentifierSchema,
    exerciseIds: z.array(ExerciseIdentifierSchema),
  }),
  z.object({
    type: z.literal("willNotRunTestsForExam"),
    target: targetPanelSchema("ExerciseTests"),
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
  z.object({
    type: z.literal("moocLoginError"),
    target: targetPanelSchema("MoocLogin"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("initializationErrors"),
    target: targetPanelSchema("InitializationErrorHelp"),
    cliFolder: z.string(),
    initializationErrors: z.object({
      tmc: initializationErrorSchema,
      userData: initializationErrorSchema,
      workspaceManager: initializationErrorSchema,
      exerciseDecorationProvider: initializationErrorSchema,
      resources: initializationErrorSchema,
    }),
  }),
])

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export type ExtensionToWebview =
  | z.infer<typeof ExtensionToWebviewSchema>
  // exists only to make TypeScript treat every panel as having at least two
  // message types, rather than one
  | {
      type: never
      target: never
    }

// helper type for messages from the extension to a specific panel
export type TargetedExtensionToWebview<T extends PanelType> = Targeted<ExtensionToWebview, T>

// helper type for messages from the extension to a specific panel type
export type BroadcastExtensionToWebview<T extends PanelType> = Broadcast<ExtensionToWebview, T>

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
  // Each `request*Data` message carries the id the host echoes back in its
  // `panelDataResult`; the webview times the request out on its own if none arrives.
  z.object({
    type: z.literal("requestCourseDetailsData"),
    requestId: z.number(),
    sourcePanel: CourseDetailsPanelSchema,
  }),
  z.object({
    type: z.literal("requestMyCoursesData"),
    requestId: z.number(),
    sourcePanel: MyCoursesPanelSchema,
  }),
  z.object({
    type: z.literal("requestWelcomeData"),
    requestId: z.number(),
    sourcePanel: WelcomePanelSchema,
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
    id: CourseIdentifierSchema,
    useCache: z.boolean(),
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
  z.object({
    type: z.literal("cancelTests"),
    testRunId: z.number(),
  }),
  z.object({
    type: z.literal("submitExercise"),
    course: LocalCourseDataSchema,
    exercise: LocalCourseExerciseSchema,
    exerciseUri: z.custom<Uri>(),
  }),
  z.object({
    type: z.literal("pasteExercise"),
    course: LocalCourseDataSchema,
    exercise: LocalCourseExerciseSchema,
    requestingPanel: strictTargetPanelSchema("ExerciseTests", "ExerciseSubmission"),
  }),
  z.object({
    type: z.literal("openLinkInBrowser"),
    // Most senders carry a backend-supplied string; the handler additionally restricts
    // the scheme, which this does not.
    url: z.url(),
  }),
  z.object({
    type: z.literal("requestInitializationErrors"),
    sourcePanel: InitializationErrorHelpPanelSchema,
  }),
  z.object({
    // Posted on MoocLogin mount; starts the CLI device-flow login, streamed back as `moocDeviceCode`.
    type: z.literal("moocLogin"),
    sourcePanel: MoocLoginPanelSchema,
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

// excludes from the message union all variants where the
// target type doesn't have the panel type
// works...somehow
export type Targeted<M, T extends PanelType> = Exclude<
  M,
  { target: { type: Exclude<PanelType, T> } }
>

export type Broadcast<M, T extends PanelType> = Omit<Targeted<M, T>, "target">
