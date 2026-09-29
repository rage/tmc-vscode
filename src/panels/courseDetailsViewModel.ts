import { ExerciseStatus } from "../api/workspaceManager"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise, match } from "../shared/shared"
import type { ExerciseGroup, ExerciseStatus as PanelExerciseStatus } from "../shared/shared"
import { dateToString, Logger, parseDate, parseNextDeadlineAfter } from "../utilities"

/**
 * One exercise row while the view is being derived: the fields the panel shows, plus the
 * parsed deadlines the derivation sorts and compares on. `toMessageGroups` drops the
 * `Date`s before the groups cross a `postMessage`.
 */
interface CourseDetailsExercise {
  id: ExerciseIdentifier
  name: string
  passed: boolean
  softDeadline: Date | null
  softDeadlineString: string
  hardDeadline: Date | null
  hardDeadlineString: string
  isHard: boolean
}

interface CourseDetailsExerciseGroup {
  name: string
  nextDeadlineString: string
  exercises: CourseDetailsExercise[]
}

/** Everything a CourseDetails panel renders, derived in one pass. */
export interface CourseDetailsView {
  /** One entry per exercise the course declares, in the order the course lists them. */
  exerciseStatuses: { exerciseId: ExerciseIdentifier; status: PanelExerciseStatus }[]
  exerciseGroups: ExerciseGroup[]
}

/**
 * Derives the CourseDetails view from data the extension already holds.
 *
 * @param workspaceExercises every on-disk exercise the workspace tracks, across all
 *   courses; an exercise `course` declares but that is absent here has not been
 *   downloaded yet.
 * @param offlineMode the backend could not be reached, so per-group deadline text is
 *   suppressed rather than derived from data that may be stale.
 * @param now the instant deadlines are judged expired against.
 */
export function buildCourseDetailsView(
  course: LocalCourseData,
  workspaceExercises: WorkspaceExercise[],
  offlineMode: boolean,
  now: Date,
): CourseDetailsView {
  const courseName = LocalCourseData.getCourseName(course)
  const courseTitle = LocalCourseData.getCourseTitle(course)
  const newExerciseKeys = new Set(
    LocalCourseData.getNewExercises(course).map((id) => ExerciseIdentifier.toString(id)),
  )
  const statusBySlug = new Map<string, ExerciseStatus>()
  for (const exercise of workspaceExercises) {
    if (exercise.backend === course.kind && exercise.courseSlug === courseName) {
      statusBySlug.set(exercise.exerciseSlug, exercise.status)
    }
  }

  const exerciseStatuses: CourseDetailsView["exerciseStatuses"] = []
  const groupsByName = new Map<string, CourseDetailsExerciseGroup>()
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { groupName, name } = placeExercise(course, slug, courseTitle)
    const group = groupsByName.get(groupName)
    const status = statusBySlug.get(slug)
    if (status === undefined) {
      Logger.debug(`Exercise ${slug} has not been downloaded yet`)
    }

    const softDeadline = ex.data.softDeadline ? parseDate(ex.data.softDeadline) : null
    const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null

    const exerciseId = LocalCourseExercise.getId(ex)
    exerciseStatuses.push({
      exerciseId,
      status: mapStatus(
        status ?? ExerciseStatus.Missing,
        hardDeadline !== null && now >= hardDeadline,
        newExerciseKeys.has(ExerciseIdentifier.toString(exerciseId)),
      ),
    })
    const entry: CourseDetailsExercise = {
      id: exerciseId,
      name,
      passed: ex.data.passed,
      softDeadline,
      softDeadlineString: softDeadline ? dateToString(softDeadline) : "-",
      hardDeadline,
      hardDeadlineString: hardDeadline ? dateToString(hardDeadline) : "-",
      isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
    }
    groupsByName.set(groupName, {
      name: groupName,
      nextDeadlineString: "",
      exercises: group?.exercises.concat(entry) || [entry],
    })
  }

  // A mooc course lists its exercises in the order its material presents them.
  const isSortedByName = course.kind === "tmc"
  const exerciseGroups: ExerciseGroup[] = Array.from(groupsByName.values())
    .toSorted((a, b) => compareNames(a.name, b.name))
    .map((e) => ({
      name: e.name,
      exercises: isSortedByName
        ? e.exercises.toSorted((a, b) => compareNames(a.name, b.name))
        : e.exercises,
      nextDeadlineString: offlineMode
        ? "Next deadline: Not available"
        : parseNextDeadlineAfter(
            now,
            e.exercises.map((ex) => ({
              date: ex.isHard ? ex.hardDeadline : ex.softDeadline,
              active: !ex.passed,
            })),
          ),
    }))

  return { exerciseStatuses, exerciseGroups }
}

/**
 * A tmc slug encodes its part as a `part01-` prefix. A mooc slug is the name the course
 * author typed, with no part in it, so every mooc exercise goes in one group named after
 * the course until the backend exposes chapters.
 */
function placeExercise(
  course: LocalCourseData,
  slug: string,
  courseTitle: string,
): { groupName: string; name: string } {
  const ungrouped = { groupName: courseTitle, name: slug }
  return match(
    course,
    () => {
      const [, groupName, name] = slug.match(/^(\w+)-(.+)$/) ?? []
      return groupName && name ? { groupName, name } : ungrouped
    },
    () => ungrouped,
  )
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function mapStatus(
  status: ExerciseStatus,
  expired: boolean,
  isNewExercise: boolean,
): PanelExerciseStatus {
  switch (status) {
    case ExerciseStatus.Closed:
      return "closed"
    case ExerciseStatus.Open:
      return "opened"
    case ExerciseStatus.Missing:
      if (expired) {
        return "expired"
      }
      return isNewExercise ? "new" : "missing"
  }
}
