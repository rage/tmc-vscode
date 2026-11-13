import { z } from "zod"

import type { CourseIdentifier, Enum, ExerciseIdentifier } from "./enum"
import { makeMoocKind, makeTmcKind, match, unwrap } from "./enum"
import { ChapterLockingStatus, CourseAiPolicy } from "./generated/langs"

// The live course schemas. Storage v3 persists exactly these (see `data_v3.ts`), so a change
// here is a storage format change.

export const SharedTmcCourseExerciseSchema = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The exercise slug. */
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
  /** The course hides submission results. */
  perhapsExamMode: z.boolean(),
  newExercises: z.array(z.number()),
  /** The new exercises a notification has offered; they are not offered again unprompted. */
  offeredNewExercises: z.array(z.number()).optional(),
  notifyAfter: z.number(),
  disabled: z.boolean(),
  materialUrl: z.string().nullable(),
})

export type SharedTmcCourseData = z.infer<typeof SharedTmcCourseDataSchema>

/** A chapter of a mooc course, as its exercises are grouped by. */
const MoocExerciseChapterSchema = z.object({
  name: z.string(),
  /** The chapter's position in the course, from 1. */
  number: z.number(),
  /** The student's place in the course's chapter locking; absent when the course has none. */
  lockingStatus: ChapterLockingStatus.optional(),
})

export const SharedMoocCourseExerciseSchema = z.object({
  id: z.string(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The name the course author gave it; its folder on disk is a kebab-cased form of it. */
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  /** Below full points with the try limit used up, so the score is final; absent means no. */
  outOfTries: z.boolean().optional(),
  /** The submissions the exercise accepts; absent means unlimited. */
  maxTries: z.number().optional(),
  /** How many of `maxTries` are left; absent means unlimited. */
  triesLeft: z.number().optional(),
  /** The chapter the course material puts the exercise in; absent outside any chapter. */
  chapter: MoocExerciseChapterSchema.optional(),
  /** The course material page the exercise is on; absent when the backend sent none. */
  pageUrl: z.string().optional(),
})

export type SharedMoocCourseExercise = z.infer<typeof SharedMoocCourseExerciseSchema>

/**
 * A chapter that has not opened yet. Its exercises are hidden until it opens, but they are
 * neither removed nor new: their files stay on disk and their points count.
 */
const MoocClosedChapterSchema = z.object({
  name: z.string(),
  number: z.number(),
  /** ISO timestamp. */
  opensAt: z.string(),
  /**
   * As last stored while the chapter was open, with the points the backend reports now. One
   * never seen open has an empty `name`.
   */
  exercises: z.array(SharedMoocCourseExerciseSchema),
})

export type MoocClosedChapter = z.infer<typeof MoocClosedChapterSchema>

export const SharedMoocCourseDataSchema = z.object({
  /** The courses.mooc.fi course id, which is the course's only client-side key. */
  id: z.string(),
  /** The course slug. */
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  organization: z.string(),
  /** The teacher's AI-use policy as courses.mooc.fi sends it; see `isAiAllowed`. */
  aiPolicy: CourseAiPolicy.default("not_set"),
  exercises: z.array(SharedMoocCourseExerciseSchema),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  newExercises: z.array(z.string()),
  /** The new exercises a notification has offered; they are not offered again unprompted. */
  offeredNewExercises: z.array(z.string()).optional(),
  notifyAfter: z.number(),
  /** courses.mooc.fi last refused the student as not enrolled on the course; absent means no. */
  notEnrolled: z.boolean().optional(),
  /** Absent means none. */
  closedChapters: z.array(MoocClosedChapterSchema).optional(),
})

export type SharedMoocCourseData = z.infer<typeof SharedMoocCourseDataSchema>

export type LocalCourseExercise = Enum<SharedTmcCourseExercise, SharedMoocCourseExercise>

/**
 * Whether an exercise's soft deadline is the one it is judged by: the exercise has both
 * deadlines and the soft one comes first. Takes the ISO timestamps a stored exercise holds.
 */
export function isSoftDeadlineBinding({
  softDeadline,
  deadline,
}: {
  softDeadline?: string | null
  deadline: string | null
}): boolean {
  return !!softDeadline && deadline !== null && Date.parse(softDeadline) < Date.parse(deadline)
}

/** What missing a binding soft deadline costs, as one sentence for the student. */
export const SOFT_DEADLINE_PENALTY =
  "An exercise submitted after its soft deadline still counts, but awards only 75% of its points."

/**
 * Why the backend would refuse a submission of an exercise, as far as its stored data tells:
 * its chapter is locked (`chapterNotUnlockedYet`, `chapterCompletedAndLocked`) or has not
 * opened yet (`chapterNotOpenYet`, which only the course's closed chapters tell), its hard
 * deadline has passed, or its tries are used up; or the student is not enrolled on its course.
 */
export type SubmitRefusal =
  | "chapterNotUnlockedYet"
  | "chapterCompletedAndLocked"
  | "chapterNotOpenYet"
  | "deadlinePassed"
  | "outOfTries"
  | "notEnrolled"

/**
 * Why the backend would refuse a submission of `exercise` at `now`; `undefined` if it would not.
 *
 * @param course The exercise's course, for its enrollment: `notEnrolled` only comes from it. A
 * submit itself leaves that to the backend, as the student may have enrolled again since.
 */
export function submitRefusalOf(
  exercise: LocalCourseExercise,
  now: Date,
  course?: Readonly<LocalCourseData>,
): SubmitRefusal | undefined {
  if (course?.kind === "mooc" && course.data.notEnrolled === true) {
    return "notEnrolled"
  }
  if (exercise.kind === "mooc") {
    switch (exercise.data.chapter?.lockingStatus) {
      case "NotUnlockedYet":
        return "chapterNotUnlockedYet"
      case "CompletedAndLocked":
        return "chapterCompletedAndLocked"
    }
  }
  const { deadline } = exercise.data
  if (deadline !== null && Date.parse(deadline) <= now.getTime()) {
    return "deadlinePassed"
  }
  if (exercise.kind === "mooc" && (exercise.data.outOfTries || exercise.data.triesLeft === 0)) {
    return "outOfTries"
  }
  return undefined
}

/**
 * The course material page that shows a mooc exercise's model solution, which courses.mooc.fi
 * reveals once the exercise is passed or out of tries; `undefined` before that, and for tmc.
 */
export function modelSolutionUrlOf(exercise: LocalCourseExercise): string | undefined {
  if (exercise.kind !== "mooc" || !(exercise.data.passed || exercise.data.outOfTries)) {
    return undefined
  }
  return exercise.data.pageUrl
}

/** A few words for a row that cannot be submitted, e.g. "deadline passed". */
export const SUBMIT_REFUSAL_LABELS: Record<SubmitRefusal, string> = {
  chapterNotUnlockedYet: "chapter not unlocked yet",
  chapterCompletedAndLocked: "chapter locked",
  chapterNotOpenYet: "chapter not open yet",
  deadlinePassed: "deadline passed",
  outOfTries: "no tries left",
  notEnrolled: "not enrolled",
}

/**
 * Why `exerciseName` cannot be submitted, as a sentence for the student.
 *
 * @param chapterName The exercise's chapter, which the chapter refusals name when known.
 */
export function submitRefusalSentence(
  refusal: SubmitRefusal,
  exerciseName: string,
  chapterName?: string,
): string {
  const chapter = chapterName === undefined ? "its chapter" : `the chapter "${chapterName}"`
  switch (refusal) {
    case "chapterNotUnlockedYet":
      return `${exerciseName} can be submitted once you have completed the chapters before ${chapter}.`
    case "chapterCompletedAndLocked":
      return `You have completed and locked ${chapter}, so ${exerciseName} can no longer be submitted.`
    case "chapterNotOpenYet":
      return `${exerciseName} can be submitted once ${chapter} opens.`
    case "deadlinePassed":
      return `The deadline of ${exerciseName} has passed, so it can no longer be submitted.`
    case "outOfTries":
      return `You have no tries left on ${exerciseName}, so it can no longer be submitted.`
    case "notEnrolled":
      return `You are not enrolled on this course, so ${exerciseName} can be submitted once you enroll again.`
  }
}

/** How many tries are left, e.g. "1 try left"; `undefined` when tries are unlimited. */
export function triesLeftText(triesLeft: number | undefined): string | undefined {
  if (triesLeft === undefined) {
    return undefined
  }
  if (triesLeft === 0) {
    return "no tries left"
  }
  return `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left`
}

export namespace LocalCourseExercise {
  export function getSlug(lce: LocalCourseExercise): string {
    return unwrap(lce).name
  }

  export function getId(lce: LocalCourseExercise): ExerciseIdentifier {
    return match(
      lce,
      (tmc) => makeTmcKind({ tmcExerciseId: tmc.id }),
      (mooc) => makeMoocKind({ moocExerciseId: mooc.id }),
    )
  }

  /** The soft deadline as stored; mooc exercises have none. */
  export function getSoftDeadline(lce: LocalCourseExercise): string | null {
    return lce.kind === "tmc" ? lce.data.softDeadline : null
  }
}

export type LocalCourseData = Enum<SharedTmcCourseData, SharedMoocCourseData>

export namespace LocalCourseData {
  export function getCourseId(lcd: LocalCourseData): CourseIdentifier {
    return match(
      lcd,
      (tmc) => makeTmcKind({ courseId: tmc.id }),
      (mooc) => makeMoocKind({ moocCourseId: mooc.id }),
    )
  }

  /**
   * The course slug: the workspace folder name, the path segment and the key for
   * per-course settings. Use {@link getCourseTitle} for anything the user reads.
   */
  export function getCourseName(lcd: LocalCourseData): string {
    return unwrap(lcd).name
  }

  /** The course's human-readable name, for every label shown to the user. */
  export function getCourseTitle(lcd: LocalCourseData): string {
    return unwrap(lcd).title
  }

  /** Whether the backend has closed the course to downloads and submissions; never for mooc. */
  export function isDisabled(lcd: LocalCourseData): boolean {
    return lcd.kind === "tmc" && lcd.data.disabled
  }

  /** Whether courses.mooc.fi last refused the student as not enrolled; never for tmc. */
  export function isNotEnrolled(lcd: LocalCourseData): boolean {
    return lcd.kind === "mooc" && lcd.data.notEnrolled === true
  }

  /** The course material's front page, if the backend names it. */
  export function getMaterialUrl(lcd: LocalCourseData): string | undefined {
    return match(
      lcd,
      (tmc) => tmc.materialUrl ?? undefined,
      (mooc) => {
        const pageUrl = mooc.exercises.find((exercise) => exercise.pageUrl)?.pageUrl
        return pageUrl === undefined ? undefined : moocCourseUrlOf(pageUrl)
      },
    )
  }

  /** Whether the course hides submission results, as an exam does; never for mooc. */
  export function isExamMode(lcd: LocalCourseData): boolean {
    return lcd.kind === "tmc" && lcd.data.perhapsExamMode
  }

  export function getNewExercises(lcd: LocalCourseData): ExerciseIdentifier[] {
    return match(
      lcd,
      (tmc) => tmc.newExercises.map((neid) => makeTmcKind({ tmcExerciseId: neid })),
      (mooc) => mooc.newExercises.map((neid) => makeMoocKind({ moocExerciseId: neid })),
    )
  }

  /**
   * The not yet opened chapter holding exercise `exerciseId`, if the course has one. Such an
   * exercise is not among {@link getExercises}.
   */
  export function getClosedChapterOf(
    lcd: LocalCourseData,
    exerciseId: ExerciseIdentifier,
  ): MoocClosedChapter | undefined {
    if (lcd.kind !== "mooc" || exerciseId.kind !== "mooc") {
      return undefined
    }
    const id = exerciseId.data.moocExerciseId
    return lcd.data.closedChapters?.find((chapter) =>
      chapter.exercises.some((exercise) => exercise.id === id),
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

/**
 * The front page of the course a courses.mooc.fi material page belongs to. Coupled to
 * secret-project-331's `course_page_url`, which builds page URLs as
 * `<base>/org/<organization>/courses/<course>/<page path>`.
 */
export function moocCourseUrlOf(pageUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return undefined
  }
  const coursePath = /^\/org\/[^/]+\/courses\/[^/]+/.exec(url.pathname)?.[0]
  return coursePath === undefined ? undefined : `${url.origin}${coursePath}`
}

/**
 * An exercise's state as the Courses view shows it: on disk (`opened`, `closed`), on its way
 * (`downloading`, `downloadFailed`), not downloaded (`missing`, `new` when the course
 * announced it, `expired` past its hard deadline), or on disk but gone from the course
 * (`removed`).
 */
export type ExerciseStatus =
  | "closed"
  | "downloading"
  | "downloadFailed"
  | "expired"
  | "missing"
  | "new"
  | "opened"
  | "removed"

export const FeedbackQuestionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  lower: z.number().optional(),
  upper: z.number().optional(),
  question: z.string(),
})

export type FeedbackQuestion = z.infer<typeof FeedbackQuestionSchema>
