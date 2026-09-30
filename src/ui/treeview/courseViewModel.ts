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
 * A tmc course is sorted by part and exercise number; a mooc course keeps the order its
 * material presents them in, under one part named after the course.
 */
export function buildCourseView(course: LocalCourseData, state: CourseViewState): PartView[] {
  const courseTitle = LocalCourseData.getCourseTitle(course)
  const newKeys = new Set(
    LocalCourseData.getNewExercises(course).map((id) => ExerciseIdentifier.key(id)),
  )
  const updateableKeys = new Set(state.updateable.map((id) => ExerciseIdentifier.key(id)))
  const onDiskBySlug = new Map(state.onDisk.map((exercise) => [exercise.exerciseSlug, exercise]))

  const exercisesByPart = new Map<string, ExerciseView[]>()
  let ungroupedPartName: string | undefined
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { partName, name, isUngrouped } = placeExercise(course, slug, courseTitle)
    if (isUngrouped) {
      ungroupedPartName = partName
    }
    const id = LocalCourseExercise.getId(ex)
    const key = ExerciseIdentifier.key(id)
    const onDisk = onDiskBySlug.get(slug)
    const softDeadline = ex.data.softDeadline ? parseDate(ex.data.softDeadline) : null
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
      awardedPoints: ex.data.awardedPoints,
      availablePoints: ex.data.availablePoints,
      softDeadline,
      hardDeadline,
      isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
      isUpdateable: updateableKeys.has(key),
      onDisk,
    }
    const partExercises = exercisesByPart.get(partName)
    if (partExercises) {
      partExercises.push(view)
    } else {
      exercisesByPart.set(partName, [view])
    }
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
    const key = `${exercise.backend}:${exercise.courseSlug}`
    const courseExercises = byCourse.get(key)
    if (courseExercises) {
      courseExercises.push(exercise)
    } else {
      byCourse.set(key, [exercise])
    }
  }
  return (course) => byCourse.get(`${course.kind}:${LocalCourseData.getCourseName(course)}`) ?? []
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
