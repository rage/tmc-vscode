import { ExerciseStatus as WorkspaceStatus } from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import type { ExerciseStatus } from "../../shared/shared"
import {
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  match,
} from "../../shared/shared"
import { findNextDateAfter, parseDate } from "../../utilities"

/** One exercise of a course, as the Courses view shows it. */
export interface ExerciseView {
  id: ExerciseIdentifier
  /** The slug without its part prefix. */
  name: string
  slug: string
  status: ExerciseStatus
  passed: boolean
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

/** A part of a course: the exercises sharing a `partNN-` slug prefix. */
export interface PartView {
  name: string
  exercises: ExerciseView[]
  /** The soonest deadline after `now` among the exercises not yet passed. */
  nextDeadline: Date | null
  /** Every part of a short course starts expanded; in a longer one only the next due. */
  isDefaultOpen: boolean
  /** Holds the exercises whose slug names no part, under the course's title. */
  isUngrouped: boolean
}

/** What the host knows about a course's exercises beyond its stored data and the disk. */
export interface CourseViewState {
  /** Every exercise the workspace tracks, across all courses. */
  workspaceExercises: WorkspaceExercise[]
  /** Download statuses posted while a download runs, see `exerciseStatusRegistry`. */
  inFlight: [ExerciseIdentifier, ExerciseStatus][]
  updateable: ExerciseIdentifier[]
  /** The instant deadlines are judged expired against. */
  now: Date
}

const MAX_PARTS_ALL_OPEN = 3

/**
 * Groups a course's exercises into parts and derives each exercise's status.
 *
 * A tmc course is sorted by part and exercise number; a mooc course keeps the order its
 * material presents them in, under one part named after the course.
 */
export function buildCourseView(course: LocalCourseData, state: CourseViewState): PartView[] {
  const courseName = LocalCourseData.getCourseName(course)
  const courseTitle = LocalCourseData.getCourseTitle(course)
  const newKeys = new Set(LocalCourseData.getNewExercises(course).map((id) => exerciseKey(id)))
  const updateableKeys = new Set(state.updateable.map((id) => exerciseKey(id)))
  const inFlightByKey = new Map(state.inFlight.map(([id, status]) => [exerciseKey(id), status]))
  const onDiskBySlug = new Map<string, WorkspaceExercise>()
  for (const exercise of state.workspaceExercises) {
    if (exercise.backend === course.kind && exercise.courseSlug === courseName) {
      onDiskBySlug.set(exercise.exerciseSlug, exercise)
    }
  }

  const exercisesByPart = new Map<string, ExerciseView[]>()
  let ungroupedPartName: string | undefined
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { partName, name, isUngrouped } = placeExercise(course, slug, courseTitle)
    if (isUngrouped) {
      ungroupedPartName = partName
    }
    const id = LocalCourseExercise.getId(ex)
    const key = exerciseKey(id)
    const onDisk = onDiskBySlug.get(slug)
    const softDeadline = ex.data.softDeadline ? parseDate(ex.data.softDeadline) : null
    const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null
    const view: ExerciseView = {
      id,
      name,
      slug,
      status: resolveStatus(
        onDisk?.status,
        inFlightByKey.get(key),
        hardDeadline !== null && state.now >= hardDeadline,
        newKeys.has(key),
      ),
      passed: ex.data.passed,
      awardedPoints: ex.data.awardedPoints,
      availablePoints: ex.data.availablePoints,
      softDeadline,
      hardDeadline,
      isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
      isUpdateable: updateableKeys.has(key),
      onDisk,
    }
    exercisesByPart.set(partName, [...(exercisesByPart.get(partName) ?? []), view])
  }

  const isSortedByName = course.kind === "tmc"
  const parts = Array.from(exercisesByPart, ([name, exercises]) => ({
    name,
    exercises: isSortedByName
      ? exercises.toSorted((a, b) => compareNames(a.name, b.name))
      : exercises,
    nextDeadline: findNextDateAfter(
      state.now,
      exercises.filter((ex) => !ex.passed).map((ex) => shownDeadline(ex)),
    ),
  })).toSorted((a, b) => compareNames(a.name, b.name))

  const openPartName = pickOpenPart(parts)
  return parts.map((part) => ({
    ...part,
    isDefaultOpen: parts.length <= MAX_PARTS_ALL_OPEN || part.name === openPartName,
    isUngrouped: part.name === ungroupedPartName,
  }))
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

/** The part holding the soonest unmet deadline, else the first part. */
function pickOpenPart(parts: { name: string; nextDeadline: Date | null }[]): string | undefined {
  let soonest: { name: string; nextDeadline: Date } | undefined
  for (const { name, nextDeadline } of parts) {
    if (nextDeadline && (!soonest || nextDeadline < soonest.nextDeadline)) {
      soonest = { name, nextDeadline }
    }
  }
  return soonest?.name ?? parts[0]?.name
}

/**
 * A tmc slug encodes its part as a `part01-` prefix. A mooc slug is the name the course
 * author typed, with no part in it, so every mooc exercise goes in one part named after
 * the course until the backend exposes chapters.
 */
function placeExercise(
  course: LocalCourseData,
  slug: string,
  courseTitle: string,
): { partName: string; name: string; isUngrouped: boolean } {
  const ungrouped = { partName: courseTitle, name: slug, isUngrouped: true }
  return match(
    course,
    () => {
      const [, partName, name] = slug.match(/^(\w+)-(.+)$/) ?? []
      return partName && name ? { partName, name, isUngrouped: false } : ungrouped
    },
    () => ungrouped,
  )
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/** A key that keeps a tmc and a mooc exercise with the same raw id apart. */
export function exerciseKey(id: ExerciseIdentifier): string {
  return `${id.kind}:${ExerciseIdentifier.toString(id)}`
}
