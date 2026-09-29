import { ExerciseStatus } from "../api/workspaceManager"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise, match } from "../shared/shared"
import type { ExerciseGroup, ExerciseStatus as PanelExerciseStatus } from "../shared/shared"
import {
  findNextDateAfter,
  formatDeadline,
  Logger,
  parseDate,
  parseNextDeadlineAfter,
} from "../utilities"

/**
 * One exercise row while the view is being derived: the row the panel shows, plus the
 * parsed deadlines the derivation sorts and compares on, which never cross a `postMessage`.
 */
interface DerivedExercise {
  row: ExerciseGroup["exercises"][number]
  softDeadline: Date | null
  hardDeadline: Date | null
}

/** Everything a CourseDetails panel renders, derived in one pass. */
export interface CourseDetailsView {
  /** One entry per exercise the course declares, in the order the course lists them. */
  exerciseStatuses: { exerciseId: ExerciseIdentifier; status: PanelExerciseStatus }[]
  exerciseGroups: ExerciseGroup[]
}

const MAX_PARTS_ALL_OPEN = 3

/**
 * Derives the CourseDetails view from data the extension already holds.
 *
 * @param workspaceExercises every on-disk exercise the workspace tracks, across all
 *   courses; an exercise `course` declares but that is absent here has not been
 *   downloaded yet.
 * @param offlineMode the backend could not be reached, so per-group deadline text is
 *   suppressed rather than derived from data that may be stale.
 * @param now the instant deadlines are judged expired against.
 * @param locale the display language deadlines are rendered in, i.e. `vscode.env.language`;
 *   `undefined` falls back to the runtime's locale.
 */
export function buildCourseDetailsView(
  course: LocalCourseData,
  workspaceExercises: WorkspaceExercise[],
  offlineMode: boolean,
  now: Date,
  locale?: string,
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
  const formatDate = (date: Date | null): string => (date ? formatDeadline(date, now, locale) : "-")

  const exerciseStatuses: CourseDetailsView["exerciseStatuses"] = []
  const exercisesByGroup = new Map<string, DerivedExercise[]>()
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const { groupName, name } = placeExercise(course, slug, courseTitle)
    const status = statusBySlug.get(slug)
    if (status === undefined) {
      Logger.debug(`Exercise ${slug} has not been downloaded yet`)
    }

    const softDeadline = ex.data.softDeadline ? parseDate(ex.data.softDeadline) : null
    const hardDeadline = ex.data.deadline ? parseDate(ex.data.deadline) : null
    const isHard = softDeadline && hardDeadline ? hardDeadline <= softDeadline : true

    const exerciseId = LocalCourseExercise.getId(ex)
    exerciseStatuses.push({
      exerciseId,
      status: mapStatus(
        status ?? ExerciseStatus.Missing,
        hardDeadline !== null && now >= hardDeadline,
        newExerciseKeys.has(ExerciseIdentifier.toString(exerciseId)),
      ),
    })
    const shownDeadline = isHard ? hardDeadline : softDeadline
    const derived: DerivedExercise = {
      row: {
        id: exerciseId,
        name,
        passed: ex.data.passed,
        softDeadlineString: formatDate(softDeadline),
        hardDeadlineString: formatDate(hardDeadline),
        deadlineIso: shownDeadline?.toISOString() ?? null,
        isHard,
      },
      softDeadline,
      hardDeadline,
    }
    exercisesByGroup.set(groupName, [...(exercisesByGroup.get(groupName) ?? []), derived])
  }

  // A mooc course lists its exercises in the order its material presents them.
  const isSortedByName = course.kind === "tmc"
  const groups = Array.from(exercisesByGroup, ([name, exercises]) => {
    const deadlines = exercises.map((ex) => ({
      date: ex.row.isHard ? ex.hardDeadline : ex.softDeadline,
      active: !ex.row.passed,
    }))
    return {
      name,
      exercises: isSortedByName
        ? exercises.toSorted((a, b) => compareNames(a.row.name, b.row.name))
        : exercises,
      deadlines,
      nextDeadline: findNextDateAfter(
        now,
        deadlines.filter((deadline) => deadline.active).map((deadline) => deadline.date),
      ),
    }
  }).toSorted((a, b) => compareNames(a.name, b.name))

  const openGroupName = pickOpenGroup(groups)
  const exerciseGroups: ExerciseGroup[] = groups.map((group) => ({
    name: group.name,
    exercises: group.exercises.map((ex) => ex.row),
    nextDeadlineString: offlineMode
      ? "Next deadline: Not available"
      : parseNextDeadlineAfter(now, group.deadlines, locale),
    defaultOpen: groups.length <= MAX_PARTS_ALL_OPEN || group.name === openGroupName,
  }))

  return { exerciseStatuses, exerciseGroups }
}

/** The part holding the soonest unmet deadline, else the first part. */
function pickOpenGroup(groups: { name: string; nextDeadline: Date | null }[]): string | undefined {
  let soonest: { name: string; nextDeadline: Date } | undefined
  for (const { name, nextDeadline } of groups) {
    if (nextDeadline && (!soonest || nextDeadline < soonest.nextDeadline)) {
      soonest = { name, nextDeadline }
    }
  }
  return soonest?.name ?? groups[0]?.name
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

/**
 * The on-disk statuses with the downloads still running, or failed, laid over them.
 *
 * A failure is shown only while the exercise is still absent from disk: one downloaded
 * since, by any route, is no longer failed.
 */
export function withInFlightStatuses(
  onDisk: CourseDetailsView["exerciseStatuses"],
  inFlight: [ExerciseIdentifier, PanelExerciseStatus][],
): [ExerciseIdentifier, PanelExerciseStatus][] {
  const inFlightById = new Map(inFlight.map(([id, status]) => [exerciseKey(id), status]))
  return onDisk.map(({ exerciseId, status }): [ExerciseIdentifier, PanelExerciseStatus] => {
    const override = inFlightById.get(exerciseKey(exerciseId))
    const isOnDisk = status === "opened" || status === "closed"
    const shown =
      override === "downloading" || (override === "downloadFailed" && !isOnDisk) ? override : status
    return [exerciseId, shown]
  })
}

function exerciseKey(id: ExerciseIdentifier): string {
  return `${id.kind}:${ExerciseIdentifier.toString(id)}`
}
