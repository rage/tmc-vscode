import type { ExerciseStatus } from "../../../shared/lib"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  isSoftDeadlineBinding,
  LocalCourseData,
  LocalCourseExercise,
  match,
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
  awardedPoints: number
  availablePoints: number
  softDeadline: Date | null
  hardDeadline: Date | null
  /** The hard deadline is the one that binds: there is no earlier soft one. */
  isHard: boolean
  isUpdateable: boolean
  /** The exercise on disk; `undefined` while it is not downloaded. */
  onDisk: WorkspaceExercise | undefined
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
}

/** What the host knows about a course's exercises beyond its stored data and the disk. */
export interface CourseViewState {
  /** The workspace's exercises of this course, as {@link onDiskByCourse} groups them. */
  onDisk: readonly WorkspaceExercise[]
  /** Whether the exercise is downloading or failed to, which the disk cannot tell. */
  downloadStatusOf: (id: ExerciseIdentifier) => "downloading" | "downloadFailed" | undefined
  updateable: ExerciseIdentifier[]
  /** The instant deadlines are judged expired against. */
  now: Date
}

const MAX_PARTS_ALL_OPEN = 3

/**
 * Groups a course's exercises into parts and derives each exercise's status.
 *
 * A tmc course is sorted by part and exercise number. A mooc course is grouped by chapter in
 * chapter order and keeps the order its material presents the exercises in; exercises outside
 * any chapter come last, under a part named after the course.
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

  const parts = new Map<string, PartPlace & { exercises: ExerciseView[] }>()
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { part, name } = placeExercise(ex, slug, courseTitle)
    const id = LocalCourseExercise.getId(ex)
    const key = ExerciseIdentifier.key(id)
    const onDisk = onDiskById.get(key)
    const softDeadlineText = LocalCourseExercise.getSoftDeadline(ex)
    const softDeadline = softDeadlineText ? parseDate(softDeadlineText) : null
    const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null
    const view: ExerciseView = {
      id,
      name,
      slug,
      status: resolveStatus(
        onDisk?.status,
        state.downloadStatusOf(id),
        hardDeadline !== null && state.now >= hardDeadline,
        newKeys.has(key),
      ),
      passed: ex.data.passed,
      isOutOfTries: ex.kind === "mooc" && ex.data.outOfTries === true,
      awardedPoints: ex.data.awardedPoints,
      availablePoints: ex.data.availablePoints,
      softDeadline,
      hardDeadline,
      isHard: !isSoftDeadlineBinding(ex.data),
      isUpdateable: updateableKeys.has(key),
      onDisk,
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
      exercises.filter((ex) => !ex.passed && !ex.isOutOfTries).map((ex) => shownDeadline(ex)),
    ),
  })).toSorted((a, b) => compareParts(a, b, isAnyNumbered))

  const openPartKey = pickOpenPart(sorted)
  return sorted.map(({ number: _number, ...part }) => ({
    ...part,
    isDefaultOpen: sorted.length <= MAX_PARTS_ALL_OPEN || part.key === openPartKey,
  }))
}

/** The part an exercise belongs in. */
interface PartPlace {
  key: string
  name: string
  /** A mooc chapter's number, which orders the chapters. */
  number?: number
  isUngrouped: boolean
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
    part: { key: ":ungrouped", name: courseTitle, isUngrouped: true },
    name: slug,
  }
  return match(
    exercise,
    () => {
      const [, partName, name] = slug.match(/^(\w+)-(.+)$/) ?? []
      return partName && name
        ? { part: { key: partName, name: partName, isUngrouped: false }, name }
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
 * Courses view lists them, that is not passed, has tries left and is not past its hard deadline;
 * failing that, the first such one before it. `undefined` when none is left.
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
    now,
  }).flatMap((part) => part.exercises)
  const currentKey = ExerciseIdentifier.key(current)
  const index = ordered.findIndex((exercise) => ExerciseIdentifier.key(exercise.id) === currentKey)
  const isLeftToDo = (exercise: ExerciseView): boolean =>
    ExerciseIdentifier.key(exercise.id) !== currentKey &&
    !exercise.passed &&
    !exercise.isOutOfTries &&
    !(exercise.hardDeadline !== null && exercise.hardDeadline <= now)
  const next =
    ordered.slice(index + 1).find((exercise) => isLeftToDo(exercise)) ??
    ordered.slice(0, Math.max(index, 0)).find((exercise) => isLeftToDo(exercise))
  return next?.id
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
    now,
  })
    .filter((part) => scope === "all" || part.isDefaultOpen)
    .flatMap((part) => part.exercises)
    .filter((exercise) => exercise.status === "missing" || exercise.status === "new")
    .map((exercise) => exercise.id)
}
