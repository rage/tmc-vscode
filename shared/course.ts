import { z } from "zod"

import type { CourseIdentifier, Enum, ExerciseIdentifier } from "./enum"
import { makeMoocKind, makeTmcKind, match, unwrap } from "./enum"
import {
  ChapterLockingStatus,
  CourseAiPolicy,
  ReviewingStage,
  TeacherDecision,
} from "./generated/langs"

// The live course schemas. Storage v3 persists exactly these (see `data_v3.ts`), so a change
// here is a storage format change.

/**
 * Why a backend last refused a course itself: `forbidden` when the student may no longer see it
 * (hidden, closed or made private), `notFound` when it no longer exists there.
 */
const CourseAccessLossSchema = z.object({
  reason: z.enum(["forbidden", "notFound"]),
  /** ms timestamp of the last refresh that found it so; background refreshes retry it rarely. */
  checkedAt: z.number(),
})

export type CourseAccessLoss = z.infer<typeof CourseAccessLossSchema>

export const SharedTmcCourseExerciseSchema = z.object({
  id: z.number(),
  availablePoints: z.number(),
  awardedPoints: z.number(),
  /** The exercise slug. */
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  /** The student has submitted it; absent means no. */
  attempted: z.boolean().optional(),
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
  /** Absent while the backend serves the course. */
  accessLoss: CourseAccessLossSchema.optional(),
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
  /** The name the course author gave it; the CLI derives its folder on disk from it. */
  name: z.string(),
  deadline: z.string().nullable(),
  passed: z.boolean(),
  /** The student has submitted it; absent means no. */
  attempted: z.boolean().optional(),
  /** Below full points with the try limit used up, so the score is final; absent means no. */
  outOfTries: z.boolean().optional(),
  /** The submissions the exercise accepts; absent means unlimited. */
  maxTries: z.number().optional(),
  /** How many of `maxTries` are left; absent means unlimited. */
  triesLeft: z.number().optional(),
  /**
   * What the exercise's points wait for when a teacher reviews answers before awarding them;
   * `awardedPoints` stays 0 until then. Absent when no review is pending.
   */
  pendingReview: z.enum(["awaits_chapter_lock", "awaits_teacher", "unrecognized"]).optional(),
  /** courses.mooc.fi takes no more submissions of it from the student; absent means no. */
  exerciseLocked: z.boolean().optional(),
  /** The chapter the course material puts the exercise in; absent outside any chapter. */
  chapter: MoocExerciseChapterSchema.optional(),
  /** The course material page the exercise is on; absent when the backend sent none. */
  pageUrl: z.string().optional(),
  /**
   * Answered on the course page only, as tmc-langs will not download it (a browser exercise, or
   * one with several editor tasks); absent means no.
   */
  browserOnly: z.boolean().optional(),
  /** The exercise's instructions as plain text paragraphs; absent when it has none. */
  instructions: z.array(z.string()).optional(),
  /** courses.mooc.fi reveals the model solution to the student; absent means no. */
  hasModelSolution: z.boolean().optional(),
  /**
   * Where the student's answer is in a peer, self or teacher review; absent outside one. An
   * unknown stored stage is dropped rather than failing the exercise's whole record.
   */
  // oxlint-disable-next-line unicorn/prefer-top-level-await -- zod's catch, not a promise's
  reviewingStage: ReviewingStage.optional().catch(undefined),
  /** A teacher's grading of the student's answer; absent when there is none. */
  // oxlint-disable-next-line unicorn/prefer-top-level-await -- zod's catch, not a promise's
  teacherReview: z
    .object({
      decision: TeacherDecision,
      justification: z.string().nullable(),
      scoreGiven: z.number(),
      createdAt: z.string(),
    })
    .optional()
    .catch(undefined),
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
  /** Absent while the backend serves the course. */
  accessLoss: CourseAccessLossSchema.optional(),
  /** Absent means none. */
  closedChapters: z.array(MoocClosedChapterSchema).optional(),
  /** The course's front page on courses.mooc.fi; absent from a backend that predates it. */
  url: z.string().optional(),
  /** The course's language, such as "fi-FI"; absent when unknown. */
  languageCode: z.string().optional(),
  /** Shared by the course's versions in other languages; absent when unknown. */
  languageGroupId: z.string().optional(),
  /** ISO timestamp of when the course ended; absent while it runs. */
  closedAt: z.string().optional(),
  /** The course that continues this one, such as its next run; absent when none. */
  successorCourseId: z.string().optional(),
  /** The student teaches or assists on the course; absent means no. */
  isStaff: z.boolean().optional(),
  /** Set when the stored course is an exam: when its answers close, as an ISO timestamp. */
  examAnswerableUntil: z.string().optional(),
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
 * opened yet (`chapterNotOpenYet`, which only the course's closed chapters tell), the exercise
 * itself is locked for review, its hard deadline has passed, or its tries are used up; or the
 * student is not enrolled on its course, or the backend no longer serves the course at all.
 */
export type SubmitRefusal =
  | "chapterNotUnlockedYet"
  | "chapterCompletedAndLocked"
  | "chapterNotOpenYet"
  | "exerciseLocked"
  | "deadlinePassed"
  | "outOfTries"
  | "notEnrolled"
  | "courseForbidden"
  | "courseNotFound"

/**
 * The refusal every surface names when several apply: the first of them here. Course-wide
 * reasons come first, then the exercise's lasting ones, then the chapter's, which pass by
 * themselves, so a student out of tries is never told to complete earlier chapters first.
 */
export const SUBMIT_REFUSAL_PRIORITY = [
  "courseNotFound",
  "courseForbidden",
  "notEnrolled",
  "exerciseLocked",
  "deadlinePassed",
  "outOfTries",
  "chapterCompletedAndLocked",
  "chapterNotOpenYet",
  "chapterNotUnlockedYet",
] as const satisfies readonly SubmitRefusal[]

/**
 * Why the backend would refuse a submission of `exercise` at `now`, by
 * {@link SUBMIT_REFUSAL_PRIORITY}; `undefined` if it would not.
 *
 * @param course The exercise's course, for its enrollment, access and closed chapters:
 * `notEnrolled`, `courseForbidden`, `courseNotFound` and `chapterNotOpenYet` only come from it. A
 * submit itself leaves those to the backend, as they may have changed since the course was last
 * refreshed.
 */
export function submitRefusalOf(
  exercise: LocalCourseExercise,
  now: Date,
  course?: Readonly<LocalCourseData>,
): SubmitRefusal | undefined {
  const applies = new Set<SubmitRefusal>()
  switch (course && LocalCourseData.getAccessLoss(course)) {
    case "forbidden":
      applies.add("courseForbidden")
      break
    case "notFound":
      applies.add("courseNotFound")
      break
  }
  if (course?.kind === "mooc" && course.data.notEnrolled === true) {
    applies.add("notEnrolled")
  }
  if (course && LocalCourseData.getClosedChapterOf(course, LocalCourseExercise.getId(exercise))) {
    applies.add("chapterNotOpenYet")
  }
  if (exercise.kind === "mooc") {
    switch (exercise.data.chapter?.lockingStatus) {
      case "NotUnlockedYet":
        applies.add("chapterNotUnlockedYet")
        break
      case "CompletedAndLocked":
        applies.add("chapterCompletedAndLocked")
        break
    }
    if (exercise.data.exerciseLocked) {
      applies.add("exerciseLocked")
    }
    if (exercise.data.outOfTries || exercise.data.triesLeft === 0) {
      applies.add("outOfTries")
    }
  }
  const { deadline } = exercise.data
  if (deadline !== null && Date.parse(deadline) <= now.getTime()) {
    applies.add("deadlinePassed")
  }
  return SUBMIT_REFUSAL_PRIORITY.find((refusal) => applies.has(refusal))
}

/** A few words for a row that cannot be submitted, e.g. "deadline passed". */
export const SUBMIT_REFUSAL_LABELS: Record<SubmitRefusal, string> = {
  chapterNotUnlockedYet: "complete earlier chapters first",
  chapterCompletedAndLocked: "chapter locked",
  chapterNotOpenYet: "chapter not open yet",
  exerciseLocked: "locked by the teacher",
  deadlinePassed: "deadline passed",
  outOfTries: "no tries left",
  notEnrolled: "not enrolled",
  courseForbidden: "no access",
  courseNotFound: "course removed",
}

/**
 * The codicon of each refusal. The course home, the Courses view and the status bar all draw a
 * refused exercise with it, so one icon means one reason everywhere.
 */
export const SUBMIT_REFUSAL_ICONS: Record<SubmitRefusal, string> = {
  chapterNotUnlockedYet: "list-ordered",
  chapterCompletedAndLocked: "lock",
  chapterNotOpenYet: "calendar",
  exerciseLocked: "lock",
  deadlinePassed: "watch",
  outOfTries: "circle-slash",
  notEnrolled: "person",
  courseForbidden: "eye-closed",
  courseNotFound: "trash",
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
      return `Complete the chapters before ${chapter} to submit ${exerciseName}.`
    case "chapterCompletedAndLocked":
      return chapterName === undefined
        ? `The chapter of ${exerciseName} is locked, so it can no longer be submitted.`
        : `The chapter "${chapterName}" is locked, so ${exerciseName} can no longer be submitted.`
    case "chapterNotOpenYet":
      return `${exerciseName} can be submitted once ${chapter} opens.`
    case "exerciseLocked":
      return `The teacher has locked ${exerciseName}, so it can no longer be submitted.`
    case "deadlinePassed":
      return `The deadline of ${exerciseName} has passed, so it can no longer be submitted.`
    case "outOfTries":
      return `You have no tries left on ${exerciseName}, so it can no longer be submitted.`
    case "notEnrolled":
      return `You are not enrolled on this course. Enroll again to submit ${exerciseName}.`
    case "courseForbidden":
      return `You no longer have access to this course, so ${exerciseName} cannot be submitted.`
    case "courseNotFound":
      return `This course no longer exists, so ${exerciseName} cannot be submitted.`
  }
}

/** What a teacher's review of an exercise waits for. */
export type PendingReview = NonNullable<SharedMoocCourseExercise["pendingReview"]>

/** A few words for a row whose answer waits for a teacher's review. */
export const PENDING_REVIEW_LABELS: Record<PendingReview, string> = {
  awaits_teacher: "waiting for teacher review",
  awaits_chapter_lock: "waiting for the chapter to be locked",
  unrecognized: "waiting for review",
}

/** The codicon of a row waiting for review, apart from {@link SUBMIT_REFUSAL_ICONS}. */
export const PENDING_REVIEW_ICONS: Record<PendingReview, string> = {
  awaits_teacher: "eye",
  awaits_chapter_lock: "milestone",
  unrecognized: "eye",
}

/**
 * Whether an exercise's points are held back for a pending teacher review. The backend holds them
 * at 0, but may also report a review on points already given, which stay shown.
 */
export function arePointsHeldForReview(
  pendingReview: SharedMoocCourseExercise["pendingReview"] | null,
  awardedPoints: number,
): boolean {
  return pendingReview !== undefined && pendingReview !== null && awardedPoints === 0
}

/**
 * What a pending teacher review means for the points, as a sentence for the student.
 *
 * @param awardedPoints The exercise's points now; see {@link arePointsHeldForReview}.
 */
export function pendingReviewSentence(pendingReview: PendingReview, awardedPoints: number): string {
  const startsOnLock = pendingReview === "awaits_chapter_lock"
  if (arePointsHeldForReview(pendingReview, awardedPoints)) {
    return startsOnLock
      ? "The points wait for a teacher's review, which starts once you complete and lock the chapter."
      : "The points wait for a teacher's review."
  }
  return startsOnLock
    ? "A teacher reviews this answer once you complete and lock the chapter, which can change the points."
    : "A teacher reviews this answer, which can change the points."
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

  /** Why the backend last refused the course itself; `undefined` while it serves it. */
  export function getAccessLoss(lcd: LocalCourseData): CourseAccessLoss["reason"] | undefined {
    return lcd.data.accessLoss?.reason
  }

  /** The course material's front page, if the backend names it. */
  export function getMaterialUrl(lcd: LocalCourseData): string | undefined {
    return match(
      lcd,
      (tmc) => tmc.materialUrl ?? undefined,
      (mooc) => {
        if (mooc.url) {
          return mooc.url
        }
        const pageUrl = mooc.exercises.find((exercise) => exercise.pageUrl)?.pageUrl
        return pageUrl === undefined ? undefined : moocCourseUrlOf(pageUrl)
      },
    )
  }

  /** Whether the course hides submission results, as an exam does; never for mooc. */
  export function isExamMode(lcd: LocalCourseData): boolean {
    return lcd.kind === "tmc" && lcd.data.perhapsExamMode
  }

  /** Whether the course is a courses.mooc.fi exam, whose id is an exam id; see {@link isExamMode}. */
  export function isMoocExam(lcd: LocalCourseData): boolean {
    return lcd.kind === "mooc" && !!lcd.data.examAnswerableUntil
  }

  /** Whether the course is a courses.mooc.fi exam whose answers closed before `now`, in epoch ms. */
  export function isClosedExam(lcd: LocalCourseData, now: number): boolean {
    const closesAt = lcd.kind === "mooc" ? Date.parse(lcd.data.examAnswerableUntil ?? "") : NaN
    return closesAt <= now
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
  | "browserOnly"
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
