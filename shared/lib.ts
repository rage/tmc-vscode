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
  Course,
  ExerciseTaskSubmissionStatus,
  MoocCourse,
  Organization,
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
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tmc"), data: tmc }),
    z.object({ kind: z.literal("mooc"), data: mooc }),
  ]) as unknown as z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>>
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

  export function getCourseName(lcd: LocalCourseData): string {
    return match(
      lcd,
      (tmc) => tmc.name,
      (mooc) => mooc.name,
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

export const LoginPanelSchema = z.object({
  id: z.number(),
  type: z.literal("Login"),
})

export type LoginPanel = z.infer<typeof LoginPanelSchema>

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
  | "Login"
  | "MyCourses"
  | "CourseDetails"
  | "SelectOrganization"
  | "SelectCourse"
  | "ExerciseTests"
  | "ExerciseSubmission"
  | "SelectPlatform"
  | "SelectMoocCourse"
  | "MoocLogin"
  | "InitializationErrorHelp"

// used to define messages that should only be sent to a specific instance of a panel
// for example, the course selected by the user on the SelectCoursePanel should only be sent
// to the panel which initiated the course selection
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
// Used only for the *webview → extension host* direction (`sourcePanel`/
// `requestingPanel` fields in `WebviewToExtensionSchema`): the webview should
// never legitimately need to send more than `{id, type}` there, so this acts
// as a guard against accidentally posting a whole (potentially Svelte 5
// `$state`-proxied) panel object, which would otherwise crash the webview
// message relay with an opaque `DataCloneError` instead of failing loudly.
//
// Deliberately NOT used for `ExtensionToWebviewSchema`/`WebviewToWebviewSchema`
// `target` fields: some existing extension-host call sites pass a whole panel
// object as `target` (harmless there, since it's a plain object the receiving
// side only reads `.id`/`.type` off), and tightening those schemas would
// reject otherwise-working messages.
function strictTargetPanelSchema<T extends PanelType>(...types: [T, ...T[]]) {
  return z.strictObject({
    id: z.number(),
    type: z.literal(types),
  })
}

export const SelectOrganizationPanelSchema = z.object({
  id: z.number(),
  type: z.literal("SelectOrganization"),
  // the result of the selection is sent back to this panel
  requestingPanel: targetPanelSchema("MyCourses"),
})

export type SelectOrganizationPanel = z.infer<typeof SelectOrganizationPanelSchema>

export const SelectCoursePanelSchema = z.object({
  id: z.number(),
  type: z.literal("SelectCourse"),
  organizationSlug: z.string(),
  // the result of the selection is sent back to this panel
  requestingPanel: targetPanelSchema("MyCourses"),
})

export type SelectCoursePanel = z.infer<typeof SelectCoursePanelSchema>

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

export const SelectPlatformPanelSchema = z.object({
  id: z.number(),
  type: z.literal("SelectPlatform"),
  requestingPanel: targetPanelSchema("MyCourses"),
})

export type SelectPlatformPanel = z.infer<typeof SelectPlatformPanelSchema>

export const SelectMoocCoursePanelSchema = z.object({
  id: z.number(),
  type: z.literal("SelectMoocCourse"),
  requestingPanel: targetPanelSchema("MyCourses"),
})

export type SelectMoocCoursePanel = z.infer<typeof SelectMoocCoursePanelSchema>

// Shown before the mooc course flow, or standalone on session expiry.
// `requestingPanel` is where to continue on success; absent for standalone.
export const MoocLoginPanelSchema = z.object({
  id: z.number(),
  type: z.literal("MoocLogin"),
  requestingPanel: targetPanelSchema("MyCourses").optional(),
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
  LoginPanelSchema,
  MyCoursesPanelSchema,
  CourseDetailsPanelSchema,
  SelectOrganizationPanelSchema,
  SelectCoursePanelSchema,
  ExerciseTestsPanelSchema,
  ExerciseSubmissionPanelSchema,
  SelectPlatformPanelSchema,
  SelectMoocCoursePanelSchema,
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
    target: targetPanelSchema("MyCourses"),
    courses: z.array(LocalCourseDataSchema),
  }),
  z.object({
    type: z.literal("setTmcDataPath"),
    target: broadcastPanelSchema("MyCourses"),
    tmcDataPath: z.string(),
  }),
  z.object({
    type: z.literal("setNextCourseDeadline"),
    target: targetPanelSchema("MyCourses"),
    courseId: CourseIdentifierSchema,
    deadline: z.string(),
  }),
  z.object({
    type: z.literal("setTmcDataSize"),
    target: targetPanelSchema("MyCourses"),
    tmcDataSize: z.string(),
  }),
  z.object({
    type: z.literal("loginError"),
    target: targetPanelSchema("Login"),
    error: z.string(),
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
  z.object({
    type: z.literal("setUpdateables"),
    target: broadcastPanelSchema("CourseDetails"),
    // Scopes the broadcast to the CourseDetails panel showing this course (main/side can differ).
    courseId: CourseIdentifierSchema,
    exerciseIds: z.array(ExerciseIdentifierSchema),
  }),
  z.object({
    type: z.literal("setOrganizations"),
    target: targetPanelSchema("SelectOrganization"),
    organizations: z.array(Organization),
  }),
  z.object({
    type: z.literal("setTmcBackendUrl"),
    target: targetPanelSchema("SelectOrganization", "SelectCourse"),
    tmcBackendUrl: z.string(),
  }),
  z.object({
    type: z.literal("setOrganization"),
    target: targetPanelSchema("SelectCourse"),
    organization: Organization,
  }),
  z.object({
    type: z.literal("setSelectableCourses"),
    target: targetPanelSchema("SelectCourse"),
    courses: z.array(Course),
  }),
  z.object({
    type: z.literal("testResults"),
    target: targetPanelSchema("ExerciseTests"),
    testResults: TestResultDataSchema,
  }),
  z.object({
    type: z.literal("testError"),
    target: targetPanelSchema("ExerciseTests"),
    error: z.custom<BaseError>(),
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
    progressPercent: z.number(),
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
    error: z.custom<Error>(),
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
  z.object({
    type: z.literal("setSelectMoocCourseData"),
    target: broadcastPanelSchema("SelectMoocCourse"),
    courseInstances: z.array(MoocCourse),
  }),
  z.object({
    type: z.literal("requestSelectCourseDataError"),
    target: targetPanelSchema("SelectCourse"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("requestSelectOrganizationDataError"),
    target: targetPanelSchema("SelectOrganization"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("requestSelectMoocCourseDataError"),
    target: targetPanelSchema("SelectMoocCourse"),
    error: z.string(),
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
 * ======== webview to webview ========
 */

/**
 * Messages relayed from one webview to another, tunnelled through the
 * extension host inside a `relayToWebview` envelope (see below) and delivered
 * by `postMessageToWebview` / received by `addMessageListener` in the webview.
 *
 * Defined here (rather than webview-only) so the relay envelope's `message`
 * field can reference it and be validated on BOTH sides of the boundary. A
 * reshaped relayed payload (e.g. renaming `selectedMoocCourse`'s `instanceId`)
 * then fails at build time — producers post the inferred `WebviewToWebview`
 * type — and at `safeParse` time on the webview → host post (`vscode.ts`) and
 * the host → webview relay (`TmcPanel`), instead of only failing silently at
 * runtime when the target webview rejects it on receipt.
 *
 * `target` uses the non-strict `targetPanelSchema`, for the reason given there.
 */
export const WebviewToWebviewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selectedOrganization"),
    target: targetPanelSchema("MyCourses"),
    slug: z.string(),
  }),
  z.object({
    type: z.literal("selectedCourse"),
    target: targetPanelSchema("MyCourses"),
    organizationSlug: z.string(),
    courseId: z.number(),
  }),
  z.object({
    type: z.literal("selectedMoocCourse"),
    target: targetPanelSchema("MyCourses"),
    // mooc has no course-instance concept, so the course id doubles as the
    // instance id and is the sole key. (A prior duplicate `courseId` field and a
    // vestigial `organizationSlug` — mooc takes its org from the fetched course,
    // not the wire — were dropped.)
    instanceId: z.string(),
    courseName: z.string(),
  }),
])

/**
 * For use with `postMessageToWebview` in the Svelte app.
 * Relayed by the extension host to another webview.
 */
export type WebviewToWebview = z.infer<typeof WebviewToWebviewSchema>

/*
 * ======== from webview ========
 */

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export const WebviewToExtensionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("requestCourseDetailsData"),
    sourcePanel: CourseDetailsPanelSchema,
  }),
  z.object({
    type: z.literal("requestExerciseSubmissionData"),
    sourcePanel: ExerciseSubmissionPanelSchema,
  }),
  z.object({
    type: z.literal("requestExerciseTestsData"),
    sourcePanel: ExerciseTestsPanelSchema,
  }),
  z.object({
    type: z.literal("requestLoginData"),
    sourcePanel: LoginPanelSchema,
  }),
  z.object({
    type: z.literal("requestMyCoursesData"),
    sourcePanel: MyCoursesPanelSchema,
  }),
  z.object({
    type: z.literal("requestSelectCourseData"),
    sourcePanel: SelectCoursePanelSchema,
  }),
  z.object({
    type: z.literal("requestSelectOrganizationData"),
    sourcePanel: SelectOrganizationPanelSchema,
  }),
  z.object({
    type: z.literal("requestWelcomeData"),
    sourcePanel: WelcomePanelSchema,
  }),
  z.object({
    type: z.literal("login"),
    sourcePanel: LoginPanelSchema,
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    type: z.literal("selectOrganization"),
    sourcePanel: strictTargetPanelSchema("MyCourses"),
  }),
  z.object({
    type: z.literal("removeCourse"),
    id: CourseIdentifierSchema,
  }),
  z.object({
    type: z.literal("openCourseWorkspace"),
    courseName: z.string(),
    // Workspace files are namespaced by backend (`<slug>-<backend>.code-workspace`);
    // a bare slug is ambiguous if a tmc and mooc course share a name.
    backend: z.enum(["tmc", "mooc"]),
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
    type: z.literal("selectCourse"),
    sourcePanel: strictTargetPanelSchema("MyCourses"),
    slug: z.string(),
  }),
  z.object({
    type: z.literal("addCourse"),
    organizationSlug: z.string(),
    courseId: CourseIdentifierSchema,
    requestingPanel: strictTargetPanelSchema("MyCourses"),
  }),
  z.object({
    type: z.literal("relayToWebview"),
    // validated against the shared relayable-message schema so a reshaped
    // payload fails on both sides, instead of the previous `z.unknown()` which
    // let the inner message be checked only at runtime on receipt
    message: WebviewToWebviewSchema,
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
    url: z.string(),
  }),
  z.object({
    type: z.literal("requestInitializationErrors"),
    sourcePanel: InitializationErrorHelpPanelSchema,
  }),
  z.object({
    type: z.literal("selectPlatform"),
    sourcePanel: strictTargetPanelSchema("MyCourses"),
  }),
  z.object({
    type: z.literal("selectMoocCourse"),
    sourcePanel: strictTargetPanelSchema("MyCourses"),
  }),
  z.object({
    type: z.literal("requestSelectMoocCourseData"),
    // the full panel, like every other `request*Data` message: the panel posts
    // `sourcePanel: panel` on mount, and `SelectMoocCoursePanel` carries a
    // `requestingPanel` field that the narrow `strictTargetPanelSchema` rejected,
    // silently dropping the initial data request at the `vscode.ts` post guard
    sourcePanel: SelectMoocCoursePanelSchema,
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
  z.object({
    type: z.literal("addMoocCourse"),
    // The course id (== instance id) is the sole key; a redundant `courseId` and
    // a vestigial `organizationSlug` were dropped (see `selectedMoocCourse`).
    instanceId: z.string(),
    courseName: z.string(),
    requestingPanel: strictTargetPanelSchema("MyCourses"),
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
