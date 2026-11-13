import type { ChapterLockingStatus } from "../../../shared/langsSchema"
import type { ExerciseStatus, MoocClosedChapter, SubmitRefusal } from "../../../shared/lib"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  isSoftDeadlineBinding,
  LocalCourseData,
  LocalCourseExercise,
  makeMoocKind,
  match,
  submitRefusalOf,
} from "../../../shared/lib"
import { ExerciseStatus as WorkspaceStatus } from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { findNextDateAfter, parseDate } from "../../utilities"

/** One exercise of a course, as the Courses view shows it. */
export interface ExerciseView {
  id: ExerciseIdentifier
  /** The slug without its part prefix. */
  name: string
  slug: string
  status: ExerciseStatus
  passed: boolean
  /** Below full points with the try limit used up, so the score is final. Only mooc has a limit. */
  isOutOfTries: boolean
  /** Only mooc has a limit; `undefined` means unlimited. */
  maxTries: number | undefined
  triesLeft: number | undefined
  /** Why the backend would refuse a submission now; `undefined` for a removed exercise. */
  submitRefusal: SubmitRefusal | undefined
  awardedPoints: number
  availablePoints: number
  softDeadline: Date | null
  hardDeadline: Date | null
  /** The hard deadline is the one that binds: there is no earlier soft one. */
  isHard: boolean
  isUpdateable: boolean
  /** The exercise on disk; `undefined` while it is not downloaded. */
  onDisk: WorkspaceExercise | undefined
  /** The course material page the exercise is on; mooc only, when the backend sent one. */
  materialUrl: string | undefined
}

/** A part of a course: a tmc course's exercises sharing a `partNN-` slug prefix, or a mooc chapter. */
export interface PartView {
  /** Unique among the course's parts, unlike `name`, as two chapters may share a name. */
  key: string
  name: string
  exercises: ExerciseView[]
  /** The soonest deadline after `now` among the exercises still open: not passed, tries left. */
  nextDeadline: Date | null
  /** Every part of a short course starts expanded; in a longer one only the next due. */
  isDefaultOpen: boolean
  /** Holds the exercises whose slug names no part, under the course's title. */
  isUngrouped: boolean
  /** A mooc chapter's number; absent for any other part. */
  number?: number
  /** A mooc chapter's place in the course's chapter locking; `undefined` without locking. */
  lockingStatus: ChapterLockingStatus | undefined
  /**
   * When the chapter opens, for one that has not yet: it lists only the exercises already on
   * disk, which cannot be submitted before then.
   */
  opensAt?: Date | undefined
}

/** What the host knows about a course's exercises beyond its stored data and the disk. */
export interface CourseViewState {
  /** The workspace's exercises of this course, as {@link onDiskByCourse} groups them. */
  onDisk: readonly WorkspaceExercise[]
  /** Whether the exercise is downloading or failed to, which the disk cannot tell. */
  downloadStatusOf: (id: ExerciseIdentifier) => "downloading" | "downloadFailed" | undefined
  updateable: ExerciseIdentifier[]
  /** Whether the exercise's backend last reported it gone. */
  isRemoved: (id: ExerciseIdentifier) => boolean
  /** The instant deadlines are judged expired against. */
  now: Date
}

const MAX_PARTS_ALL_OPEN = 3

const REMOVED_PART: PartPlace = {
  key: ":removed",
  name: "Removed from the course",
  isUngrouped: false,
  lockingStatus: undefined,
}

/**
 * Groups a course's exercises into parts and derives each exercise's status.
 *
 * A tmc course is sorted by part and exercise number. A mooc course is grouped by chapter in
 * chapter order and keeps the order its material presents the exercises in; exercises outside
 * any chapter come last, under a part named after the course. Exercises on disk that the
 * backend no longer has, or that the course no longer lists, come after everything else.
 * Exercises in a chapter that has not opened yet are left out unless they are on disk.
 */
export function buildCourseView(course: LocalCourseData, state: CourseViewState): PartView[] {
  const courseTitle = LocalCourseData.getCourseTitle(course)
  const newKeys = new Set(
    LocalCourseData.getNewExercises(course).map((id) => ExerciseIdentifier.key(id)),
  )
  const updateableKeys = new Set(state.updateable.map((id) => ExerciseIdentifier.key(id)))
  const onDiskById = new Map(
    state.onDisk.map((exercise) => [ExerciseIdentifier.key(exercise.id), exercise]),
  )
  // A closed chapter's exercises stay hidden, except the ones the student already has.
  const closedOnDisk = (course.kind === "mooc" ? (course.data.closedChapters ?? []) : []).flatMap(
    (chapter) =>
      chapter.exercises
        .filter((exercise) =>
          onDiskById.has(ExerciseIdentifier.key(makeMoocKind({ moocExerciseId: exercise.id }))),
        )
        .map((exercise) => ({
          ex: makeMoocKind(exercise) as LocalCourseExercise,
          closed: chapter,
        })),
  )

  const parts = new Map<string, PartPlace & { exercises: ExerciseView[] }>()
  const removed: ExerciseView[] = []
  const entries: { ex: LocalCourseExercise; closed?: MoocClosedChapter }[] = [
    ...LocalCourseData.getExercises(course).map((ex) => ({ ex })),
    ...closedOnDisk,
  ]
  for (const { ex, closed } of entries) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { part, name } = closed
      ? { part: closedChapterPlace(closed), name: slug }
      : placeExercise(ex, slug, courseTitle)
    const id = LocalCourseExercise.getId(ex)
    const key = ExerciseIdentifier.key(id)
    const onDisk = onDiskById.get(key)
    onDiskById.delete(key)
    const isRemoved = state.isRemoved(id)
    const softDeadlineText = LocalCourseExercise.getSoftDeadline(ex)
    const softDeadline = softDeadlineText ? parseDate(softDeadlineText) : null
    const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null
    const view: ExerciseView = {
      id,
      name,
      slug,
      status: isRemoved
        ? "removed"
        : resolveStatus(
            onDisk?.status,
            state.downloadStatusOf(id),
            hardDeadline !== null && state.now >= hardDeadline,
            newKeys.has(key),
          ),
      passed: ex.data.passed,
      isOutOfTries: ex.kind === "mooc" && ex.data.outOfTries === true,
      maxTries: ex.kind === "mooc" ? ex.data.maxTries : undefined,
      triesLeft: ex.kind === "mooc" ? ex.data.triesLeft : undefined,
      submitRefusal: isRemoved
        ? undefined
        : closed
          ? "chapterNotOpenYet"
          : submitRefusalOf(ex, state.now, course),
      awardedPoints: ex.data.awardedPoints,
      availablePoints: ex.data.availablePoints,
      softDeadline,
      hardDeadline,
      isHard: !isSoftDeadlineBinding(ex.data),
      isUpdateable: !isRemoved && updateableKeys.has(key),
      onDisk,
      materialUrl: ex.kind === "mooc" ? ex.data.pageUrl : undefined,
    }
    if (isRemoved) {
      removed.push(view)
      continue
    }
    const existing = parts.get(part.key)
    if (existing) {
      existing.exercises.push(view)
    } else {
      parts.set(part.key, { ...part, exercises: [view] })
    }
  }

  const isSortedByName = course.kind === "tmc"
  const isAnyNumbered = [...parts.values()].some((part) => part.number !== undefined)
  const sorted = Array.from(parts.values(), ({ exercises, ...part }) => ({
    ...part,
    exercises: isSortedByName
      ? exercises.toSorted((a, b) => compareNames(a.name, b.name))
      : exercises,
    nextDeadline: findNextDateAfter(
      state.now,
      exercises
        .filter((ex) => !ex.passed && ex.submitRefusal === undefined)
        .map((ex) => shownDeadline(ex)),
    ),
  })).toSorted((a, b) => compareParts(a, b, isAnyNumbered))

  // The loop above took out every exercise the course lists.
  removed.push(...Array.from(onDiskById.values(), (onDisk) => removedFromCourse(onDisk)))
  const withRemoved =
    removed.length > 0
      ? [...sorted, { ...REMOVED_PART, exercises: removed, nextDeadline: null }]
      : sorted

  const openPartKey = pickOpenPart(sorted)
  return withRemoved.map((part) => ({
    ...part,
    isDefaultOpen: withRemoved.length <= MAX_PARTS_ALL_OPEN || part.key === openPartKey,
  }))
}

/** The part of a chapter that has not opened yet, named by number if it was never seen open. */
function closedChapterPlace(chapter: MoocClosedChapter): PartPlace {
  return {
    key: `chapter:${chapter.number}`,
    name: chapter.name || `Chapter ${chapter.number}`,
    number: chapter.number,
    isUngrouped: false,
    lockingStatus: undefined,
    opensAt: parseDate(chapter.opensAt) ?? undefined,
  }
}

/** A row for an exercise on disk that its course no longer lists. */
function removedFromCourse(onDisk: WorkspaceExercise): ExerciseView {
  return {
    id: onDisk.id,
    name: onDisk.exerciseSlug,
    slug: onDisk.exerciseSlug,
    status: "removed",
    passed: false,
    isOutOfTries: false,
    maxTries: undefined,
    triesLeft: undefined,
    submitRefusal: undefined,
    awardedPoints: 0,
    availablePoints: 0,
    softDeadline: null,
    hardDeadline: null,
    isHard: true,
    isUpdateable: false,
    onDisk,
    materialUrl: undefined,
  }
}

/** The part an exercise belongs in. */
interface PartPlace {
  key: string
  name: string
  /** A mooc chapter's number, which orders the chapters. */
  number?: number
  isUngrouped: boolean
  lockingStatus: ChapterLockingStatus | undefined
  /** When a chapter that has not opened yet opens; absent for an open part. */
  opensAt?: Date | undefined
}

/**
 * Groups every exercise the workspace tracks by the course it belongs to.
 *
 * @returns a lookup giving a course's exercises; two courses sharing a slug across backends
 * stay apart.
 */
export function onDiskByCourse(
  workspaceExercises: readonly WorkspaceExercise[],
): (course: LocalCourseData) => readonly WorkspaceExercise[] {
  const byCourse = new Map<string, WorkspaceExercise[]>()
  for (const exercise of workspaceExercises) {
    const key = CourseIdentifier.key(exercise.courseId)
    const courseExercises = byCourse.get(key)
    if (courseExercises) {
      courseExercises.push(exercise)
    } else {
      byCourse.set(key, [exercise])
    }
  }
  return (course) => byCourse.get(CourseIdentifier.key(LocalCourseData.getCourseId(course))) ?? []
}

/** The deadline an exercise is judged by: the soft one when it comes first. */
export function shownDeadline(
  exercise: Pick<ExerciseView, "isHard" | "softDeadline" | "hardDeadline">,
): Date | null {
  return exercise.isHard ? exercise.hardDeadline : exercise.softDeadline
}

/**
 * A download in flight wins over the disk, and a failed one shows only while the exercise
 * is still absent: one downloaded since, by any route, is no longer failed.
 */
function resolveStatus(
  onDisk: WorkspaceStatus | undefined,
  inFlight: ExerciseStatus | undefined,
  isExpired: boolean,
  isNew: boolean,
): ExerciseStatus {
  const isOnDisk = onDisk === WorkspaceStatus.Open || onDisk === WorkspaceStatus.Closed
  if (inFlight === "downloading" || (inFlight === "downloadFailed" && !isOnDisk)) {
    return inFlight
  }
  switch (onDisk) {
    case WorkspaceStatus.Open:
      return "opened"
    case WorkspaceStatus.Closed:
      return "closed"
    default:
      if (isExpired) {
        return "expired"
      }
      return isNew ? "new" : "missing"
  }
}

/** The key of the part holding the soonest unmet deadline, else of the first part. */
function pickOpenPart(parts: { key: string; nextDeadline: Date | null }[]): string | undefined {
  let soonest: { key: string; nextDeadline: Date } | undefined
  for (const { key, nextDeadline } of parts) {
    if (nextDeadline && (!soonest || nextDeadline < soonest.nextDeadline)) {
      soonest = { key, nextDeadline }
    }
  }
  return soonest?.key ?? parts[0]?.key
}

/**
 * A tmc slug encodes its part as a `part01-` prefix. A mooc slug is the name the course
 * author typed, with no part in it, so a mooc exercise's part is its chapter.
 */
function placeExercise(
  exercise: LocalCourseExercise,
  slug: string,
  courseTitle: string,
): { part: PartPlace; name: string } {
  const ungrouped = {
    part: { key: ":ungrouped", name: courseTitle, isUngrouped: true, lockingStatus: undefined },
    name: slug,
  }
  return match(
    exercise,
    () => {
      const [, partName, name] = slug.match(/^(\w+)-(.+)$/) ?? []
      return partName && name
        ? {
            part: { key: partName, name: partName, isUngrouped: false, lockingStatus: undefined },
            name,
          }
        : ungrouped
    },
    ({ chapter }) =>
      chapter
        ? {
            part: {
              key: `chapter:${chapter.number}`,
              name: chapter.name,
              number: chapter.number,
              isUngrouped: false,
              lockingStatus: chapter.lockingStatus,
            },
            name: slug,
          }
        : ungrouped,
  )
}

/** Chapters in chapter order with the unchaptered exercises after them; otherwise by name. */
function compareParts(a: PartPlace, b: PartPlace, isAnyNumbered: boolean): number {
  if (isAnyNumbered && (a.isUngrouped || b.isUngrouped)) {
    return Number(a.isUngrouped) - Number(b.isUngrouped)
  }
  if (a.number !== undefined && b.number !== undefined) {
    return a.number - b.number
  }
  return compareNames(a.name, b.name)
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/**
 * The exercise a student goes on to after `current`: the first one after it, in the order the
 * Courses view lists them, that is left to do (see {@link isLeftToDo}); failing that, the first
 * such one before it. `undefined` when none is left.
 */
export function nextExerciseAfter(
  course: LocalCourseData,
  current: ExerciseIdentifier,
  now: Date,
): ExerciseIdentifier | undefined {
  const ordered = buildCourseView(course, {
    onDisk: [],
    downloadStatusOf: () => undefined,
    updateable: [],
    isRemoved: () => false,
    now,
  }).flatMap((part) => part.exercises)
  const currentKey = ExerciseIdentifier.key(current)
  const index = ordered.findIndex((exercise) => ExerciseIdentifier.key(exercise.id) === currentKey)
  const isNext = (exercise: ExerciseView): boolean =>
    ExerciseIdentifier.key(exercise.id) !== currentKey && isLeftToDo(exercise)
  const next =
    ordered.slice(index + 1).find((exercise) => isNext(exercise)) ??
    ordered.slice(0, Math.max(index, 0)).find((exercise) => isNext(exercise))
  return next?.id
}

/**
 * Whether the student can still earn the exercise: still in the course, not passed, and nothing
 * stops a submission (see `submitRefusalOf`) at the view's `now`.
 */
export function isLeftToDo(exercise: ExerciseView): boolean {
  return exercise.status !== "removed" && !exercise.passed && exercise.submitRefusal === undefined
}

/**
 * The course's exercises that are not on disk and can still be submitted, in the order the
 * Courses view lists them.
 *
 * @param scope `"startingParts"` keeps only the parts the Courses view opens first: every part
 * of a short course, else the one with the soonest deadline.
 */
export function exercisesToDownload(
  course: LocalCourseData,
  onDisk: readonly WorkspaceExercise[],
  now: Date,
  scope: "all" | "startingParts",
): ExerciseIdentifier[] {
  return buildCourseView(course, {
    onDisk,
    downloadStatusOf: () => undefined,
    updateable: [],
    isRemoved: () => false,
    now,
  })
    .filter((part) => scope === "all" || part.isDefaultOpen)
    .flatMap((part) => part.exercises)
    .filter((exercise) => exercise.status === "missing" || exercise.status === "new")
    .map((exercise) => exercise.id)
}
