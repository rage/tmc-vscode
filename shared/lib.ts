import * as util from "node:util"

import type { Uri } from "vscode"
import { z } from "zod"

// types shared between the extension and webview code
//
// the runtime-validated types are defined as zod schemas with the
// TypeScript types inferred from them (`z.infer`), so the schema is
// the single source of truth for both sides of the message boundary.
//
// langs types (`./langsSchema`) are validated with the same zod
// schemas used at the CLI boundary. types that cannot be validated
// meaningfully (`vscode.Uri`, `Error` instances) are passed through
// with `z.custom<T>()` — `vscode.Uri` does not survive `postMessage`
// serialization as a class instance anyway.
/*
 * ======== imports ========
 */
import {
  ExerciseTaskSubmissionStatus,
  RunResult,
  StyleValidationResult,
  SubmissionFinished,
} from "./langsSchema"

/*
 * ======== enum & identifiers ========
 */

interface TmcKind {
  kind: "tmc"
}

interface MoocKind {
  kind: "mooc"
}

export type Enum<Tmc, Mooc> = { kind: "tmc"; data: Tmc } | { kind: "mooc"; data: Mooc }

// schema equivalent of the `Enum<Tmc, Mooc>` tagged union
//
// the return type is annotated as `z.ZodType<Enum<...>>` so that the inferred
// type of an enum schema is exactly the `Enum<A, B>` alias — this keeps
// generic helpers like `match` inferring the same way they do for
// hand-written `Enum<A, B>` types
export function EnumSchema<Tmc extends z.ZodType, Mooc extends z.ZodType>(
  tmc: Tmc,
  mooc: Mooc,
): z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>> {
  // the cast is needed because TypeScript cannot prove that the mapped types
  // in zod's inferred object types simplify to `Enum`'s members while `Tmc` and
  // `Mooc` are still generic; every call site is checked against the annotated
  // return type above
  //
  // the price of the annotation is that zod's own `.options` and `.extend()` are
  // no longer visible on the result — use `enumSchemaKinds` for the arms
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tmc"), data: tmc }),
    z.object({ kind: z.literal("mooc"), data: mooc }),
  ]) as unknown as z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>>
}

/** The arms every `EnumSchema` carries, in declaration order. */
export function enumSchemaKinds(): readonly ["tmc", "mooc"] {
  return ["tmc", "mooc"]
}

export namespace Enum {
  // oxlint-disable-next-line no-shadow -- the namespace-scoped helpers deliberately reuse the module-level `unwrap` name (qualified access, e.g. Enum.unwrap)
  export function unwrap<A, B>(e: Enum<A, B>): A | B {
    return match(
      e,
      (value) => value,
      (value) => value,
    )
  }
}

export const CourseIdentifierSchema = EnumSchema(
  z.object({ courseId: z.number() }),
  z.object({ instanceId: z.string() }),
)

export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>

export namespace CourseIdentifier {
  export function from(id: number | string): CourseIdentifier {
    if (typeof id === "number") {
      return makeTmcKind({ courseId: id })
    } else if (typeof id === "string") {
      return makeMoocKind({ instanceId: id })
    }
    assertUnreachable(id)
  }

  export function toString(id: CourseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.courseId.toString(),
      (mooc) => mooc.instanceId,
    )
  }
}

export type TmcExerciseId = number
export type MoocExerciseId = string

export const ExerciseIdentifierSchema = EnumSchema(
  z.object({ tmcExerciseId: z.number() }),
  z.object({ moocExerciseId: z.string() }),
)

export type ExerciseIdentifier = z.infer<typeof ExerciseIdentifierSchema>

export namespace ExerciseIdentifier {
  export function from(id: number | string): ExerciseIdentifier {
    if (typeof id === "number") {
      return makeTmcKind({ tmcExerciseId: id })
    } else if (typeof id === "string") {
      return makeMoocKind({ moocExerciseId: id })
    }
    assertUnreachable(id)
  }

  // oxlint-disable-next-line no-shadow -- deliberate qualified-name reuse (ExerciseIdentifier.unwrap)
  export function unwrap(id: ExerciseIdentifier): number | string {
    if (id.kind === "tmc") {
      return id.data.tmcExerciseId
    }
    if (id.kind === "mooc") {
      return id.data.moocExerciseId
    }
    assertUnreachable(id)
  }

  export function toString(id: ExerciseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.tmcExerciseId.toString(),
      (mooc) => mooc.moocExerciseId,
    )
  }
}

// helper to simulate Rust's `match`
export function match<A, B, C, D>(data: Enum<A, B>, tmc: (x: A) => C, mooc: (x: B) => D): C | D {
  switch (data.kind) {
    case "tmc": {
      return tmc(data.data)
    }
    case "mooc": {
      return mooc(data.data)
    }
    default: {
      assertUnreachable(data)
    }
  }
}

export function matchBackend<A extends { backend: "tmc" | "mooc" }, B, C>(
  data: A,
  tmc: (x: A) => B,
  mooc: (x: A) => C,
): B | C {
  switch (data.backend) {
    case "tmc": {
      return tmc(data)
    }
    case "mooc": {
      return mooc(data)
    }
    default: {
      assertUnreachable(data.backend)
    }
  }
}

/**
 * The name to show the user for a backend. Course slugs and titles are only
 * unique within one backend, so anything listing courses from both must name
 * the backend alongside them.
 *
 * This is the only place those names are spelled: no component, panel or message
 * writes "TMC Server", "TestMyCode", "courses.mooc.fi" or "Courses MOOC" itself.
 * Backend base URLs follow the same rule and come from the `__TMC_BACKEND_URL__`
 * and `__MOOC_BACKEND_URL__` build defines in `config.js`, never from a literal.
 */
export function backendName(kind: "tmc" | "mooc"): string {
  return kind === "tmc" ? "TMC Server" : "courses.mooc.fi"
}

/**
 * The name to show the user for a backend's paste service, where an exercise can be shared
 * for help. Derived from {@link backendName} so the two never disagree.
 */
export function pasteServiceName(kind: "tmc" | "mooc"): string {
  return `${backendName(kind)} paste`
}

export function matchOption<A, B, T extends Enum<A, B> | undefined>(
  data: T,
  tmc: (x: T & TmcKind) => A,
  mooc: (x: T & MoocKind) => B,
): A | B | undefined {
  switch (data?.kind) {
    case "tmc": {
      return tmc(data as T & TmcKind)
    }
    case "mooc": {
      return mooc(data as T & MoocKind)
    }
    case undefined: {
      return undefined
    }
    default: {
      assertUnreachable(data)
    }
  }
}

export function makeTmcKind<T>(t: T): { kind: "tmc" } & { data: T } {
  return { kind: "tmc", data: t }
}

export function makeMoocKind<T>(t: T): { kind: "mooc" } & { data: T } {
  return { kind: "mooc", data: t }
}

export function unwrap<A, B>(e: Enum<A, B>): A | B {
  return match(
    e,
    (a) => a,
    (b) => b,
  )
}

export function assertUnreachable(x: never): never {
  throw new Error(`Unreachable ${JSON.stringify(x, null, 2)}`)
}

/*
 * ======== state ========
 */

// duplicated from the data module; keep in sync manually
export const SharedTmcCourseExerciseSchema = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /// Equivalent to exercise slug
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export type SharedTmcCourseExercise = z.infer<typeof SharedTmcCourseExerciseSchema>

export const SharedTmcCourseDataSchema = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  organization: z.string(),
  exercises: z.array(SharedTmcCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedTmcCourseData = z.infer<typeof SharedTmcCourseDataSchema>

export const SharedMoocCourseExerciseSchema = z.object({
  id: z.string(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /// Equivalent to exercise slug
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  softDeadline: z.string().nullable(),
})

export type SharedMoocCourseExercise = z.infer<typeof SharedMoocCourseExerciseSchema>

export const SharedMoocCourseDataSchema = z.object({
  // The courses.mooc.fi course id. There is no separate course-instance concept
  // on this backend (the backend resolves the enrolled instance from the user's
  // identity), so the course id is the sole client-side course key.
  id: z.string(),
  // course slug
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  organization: z.string(),
  exercises: z.array(SharedMoocCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.string()),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedMoocCourseData = z.infer<typeof SharedMoocCourseDataSchema>

export const LocalCourseExerciseSchema = EnumSchema(
  SharedTmcCourseExerciseSchema,
  SharedMoocCourseExerciseSchema,
)

export type LocalCourseExercise = Enum<SharedTmcCourseExercise, SharedMoocCourseExercise>

export namespace LocalCourseExercise {
  export function getSlug(lce: LocalCourseExercise): string {
    return match(
      lce,
      (tmc) => tmc.name,
      (mooc) => mooc.name,
    )
  }

  // oxlint-disable-next-line no-shadow -- deliberate qualified-name reuse (LocalCourseExercise.unwrap)
  export function unwrap(
    lce: LocalCourseExercise,
  ): SharedTmcCourseExercise | SharedMoocCourseExercise {
    return match(
      lce,
      (tmc) => tmc,
      (mooc) => mooc,
    )
  }

  export function getId(lce: LocalCourseExercise): ExerciseIdentifier {
    const id = match(
      lce,
      (tmc) => tmc.id,
      (mooc) => mooc.id,
    )
    return ExerciseIdentifier.from(id)
  }
}

export const LocalCourseDataSchema = EnumSchema(
  SharedTmcCourseDataSchema,
  SharedMoocCourseDataSchema,
)

export type LocalCourseData = Enum<SharedTmcCourseData, SharedMoocCourseData>

export namespace LocalCourseData {
  export function getCourseId(lcd: LocalCourseData): CourseIdentifier {
    return match(
      lcd,
      (tmc) => makeTmcKind({ courseId: tmc.id }),
      // mooc has no instance concept; the course id is the identifier (carried
      // under the `instanceId` label on the CourseIdentifier mooc arm)
      (mooc) => makeMoocKind({ instanceId: mooc.id }),
    )
  }

  /**
   * The course slug: the workspace folder name, the path segment and the key for
   * per-course settings. Use {@link getCourseTitle} for anything the user reads.
   */
  export function getCourseName(lcd: LocalCourseData): string {
    return match(
      lcd,
      (tmc) => tmc.name,
      (mooc) => mooc.name,
    )
  }

  /** The course's human-readable name, for every label shown to the user. */
  export function getCourseTitle(lcd: LocalCourseData): string {
    return match(
      lcd,
      (tmc) => tmc.title,
      (mooc) => mooc.title,
    )
  }

  export function getNewExercises(lcd: LocalCourseData): ExerciseIdentifier[] {
    return match(
      lcd,
      (tmc) => tmc.newExercises.map((neid) => makeTmcKind({ tmcExerciseId: neid })),
      (mooc) => mooc.newExercises.map((neid) => makeMoocKind({ moocExerciseId: neid })),
    )
  }

  export function getExercises(lcd: LocalCourseData): LocalCourseExercise[] {
    return match(
      lcd,
      (tmc) => tmc.exercises.map(makeTmcKind),
      (mooc) => mooc.exercises.map(makeMoocKind),
    )
  }
}

export function getCourseExercises(
  course: LocalCourseData,
): Enum<SharedTmcCourseExercise[], SharedMoocCourseExercise[]> {
  // TS can't infer the return type without an intermediate variable
  const ret = match(
    course,
    (tmc) => makeTmcKind(tmc.exercises),
    (mooc) => makeMoocKind(mooc.exercises),
  )
  return ret
}

/*
 * ======== additional types ========
 */

export const ExerciseStatusSchema = z.enum([
  "closed",
  "downloading",
  "downloadFailed",
  "expired",
  "missing",
  "new",
  "opened",
])

export type ExerciseStatus = z.infer<typeof ExerciseStatusSchema>

export const ExerciseSchema = z.object({
  id: ExerciseIdentifierSchema,
  name: z.string(),
  isHard: z.boolean(),
  hardDeadlineString: z.string(),
  softDeadlineString: z.string(),
  passed: z.boolean(),
})

export type Exercise = z.infer<typeof ExerciseSchema>

export const ExerciseGroupSchema = z.object({
  name: z.string(),
  exercises: z.array(ExerciseSchema),
  nextDeadlineString: z.string(),
})

export type ExerciseGroup = z.infer<typeof ExerciseGroupSchema>

export interface TestExercise {
  id: number
  availablePoints: number
  awardedPoints: number
  /// Equivalent to exercise slug
  name: string
  deadline: string | null
  passed: boolean
  softDeadline: string | null
}

export const TestResultDataSchema = z.object({
  testResult: RunResult,
  id: ExerciseIdentifierSchema,
  courseSlug: z.string(),
  exerciseName: z.string(),
  tmcLogs: z.object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }),
  pasteLink: z.string().optional(),
  disabled: z.boolean().optional(),
  styleValidationResult: StyleValidationResult.nullable().optional(),
})

export type TestResultData = z.infer<typeof TestResultDataSchema>

export interface TestCourse {
  id: CourseIdentifier
  name: string
  title: string
  description: string
  organization: string
  availablePoints: number
  awardedPoints: number
  perhapsExamMode: boolean
  newExercises: number[]
  notifyAfter: number
  disabled: boolean
  materialUrl: string | null
}

export const FeedbackQuestionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  lower: z.number().optional(),
  upper: z.number().optional(),
  question: z.string(),
})

export type FeedbackQuestion = z.infer<typeof FeedbackQuestionSchema>

/*
 * ======== panels ========
 */

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
// Deliberately NOT used for `ExtensionToWebviewSchema`'s `target` fields: some
// existing extension-host call sites pass a whole panel object as `target`
// (harmless there, since it's a plain object the receiving side only reads
// `.id`/`.type` off), and tightening those schemas would reject
// otherwise-working messages.
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
 * Contains the state of the webview.
 */
export const StateSchema = z.object({
  panel: PanelSchema,
})

export type State = z.infer<typeof StateSchema>

/*
 * ======== messages to webview ========
 */

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
  // A panel asked for its data and it could not be assembled. The panel renders this
  // where it was showing a spinner, so a failed load stops looking like a slow one.
  z.object({
    type: z.literal("panelDataError"),
    target: targetPanelSchema("MyCourses", "CourseDetails"),
    error: WebviewErrorSchema,
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

/*
 * ======== from webview ========
 */

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
  z.object({
    type: z.literal("requestCourseDetailsData"),
    sourcePanel: CourseDetailsPanelSchema,
  }),
  z.object({
    type: z.literal("requestMyCoursesData"),
    sourcePanel: MyCoursesPanelSchema,
  }),
  z.object({
    type: z.literal("requestWelcomeData"),
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

/*
 * ======== helpers ========
 */

// excludes from the message union all variants where the
// target type doesn't have the panel type
// works...somehow
export type Targeted<M, T extends PanelType> = Exclude<
  M,
  { target: { type: Exclude<PanelType, T> } }
>

export type Broadcast<M, T extends PanelType> = Omit<Targeted<M, T>, "target">

/*
 * ======== errors ========
 */

// checks the optional fields of `NodeJS.ErrnoException`;
// the `Error` part is expected to have been checked already
// (with `util.types.isNativeError`)
const errnoExceptionFieldsSchema = z.object({
  errno: z.number().optional(),
  code: z.string().optional(),
  path: z.string().optional(),
  syscall: z.string().optional(),
})

function isErrnoException(err: Error): err is NodeJS.ErrnoException {
  return errnoExceptionFieldsSchema.safeParse(err).success
}

export class BaseError extends Error {
  public override readonly name: string = "Base Error"
  public details?: string | undefined
  public override cause?: NodeJS.ErrnoException | string
  public override stack?: string

  // possible fields from ErrnoException
  public errno?: number | undefined
  public code?: string | undefined
  public path?: string | undefined
  public syscall?: string | undefined

  public constructor(err?: unknown, details?: string)

  public constructor(err: unknown, details?: string, causeParam?: string) {
    let message = ""
    let stack = ""
    let cause: NodeJS.ErrnoException | string = causeParam || ""

    let errno: number | undefined = undefined
    let code: string | undefined = undefined
    let path: string | undefined = undefined
    let syscall: string | undefined = undefined

    if (typeof err === "string") {
      message = err
    } else if (util.types.isNativeError(err)) {
      message = err.message
      if (err.stack) {
        stack = err.stack
      }

      if (isErrnoException(err)) {
        errno = err.errno
        code = err.code
        path = err.path
        syscall = err.syscall
      }

      if (err.cause) {
        if (util.types.isNativeError(err.cause) && isErrnoException(err.cause)) {
          cause = err.cause
        } else {
          cause = err.cause.toString()
        }
      }
    } else {
      // callers often hit this with `unknown` from catch blocks; anything that
      // isn't a string or Error falls through to a generic message
      message = `Unexpected error ${err} (${typeof err})`
    }

    super(message)
    this.details = details
    if (stack) {
      this.stack = stack
    }
    if (cause) {
      this.cause = cause
    }

    this.errno = errno
    this.code = code
    this.path = path
    this.syscall = syscall
  }

  public override toString(): string {
    let errorMessage = ""
    if (this.errno) {
      errorMessage += `[${this.errno}] `
    }
    if (this.code) {
      errorMessage += `(${this.code}) `
    }
    if (this.syscall) {
      errorMessage += `\`${this.syscall}\` `
    }
    if (this.path) {
      errorMessage += `@${this.path} `
    }
    errorMessage += `${this.name}: ${this.message}.`
    if (this.details) {
      errorMessage += ` ${this.details}.`
    }
    if (this.cause) {
      errorMessage += ` Caused by: ${this.cause}.`
    }
    return errorMessage
  }
}
