import { ExerciseStatus } from "../api/workspaceManager"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise } from "../shared/shared"
import type { ExerciseGroup } from "../shared/shared"
import type * as UITypes from "../ui/types"
import { dateToString, Logger, parseDate, parseNextDeadlineAfter } from "../utilities"

/** Everything a CourseDetails panel renders, derived in one pass. */
export interface CourseDetailsView {
  /** One entry per exercise the course declares, in the order the course lists them. */
  exerciseStatuses: { exerciseId: ExerciseIdentifier; status: UITypes.ExerciseStatus }[]
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
  const statusBySlug = new Map<string, ExerciseStatus>()
  for (const exercise of workspaceExercises) {
    if (exercise.backend === course.kind && exercise.courseSlug === courseName) {
      statusBySlug.set(exercise.exerciseSlug, exercise.status)
    }
  }

  const exerciseStatuses: CourseDetailsView["exerciseStatuses"] = []
  const groupsByName = new Map<string, UITypes.CourseDetailsExerciseGroup>()
  for (const ex of LocalCourseData.getExercises(course)) {
    const slug = LocalCourseExercise.getSlug(ex)
    const nameMatch = slug.match(/(\w+)-(.+)/)
    const groupName = nameMatch?.[1] || ""
    const group = groupsByName.get(groupName)
    const name = nameMatch?.[2] || ""
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
      ),
    })
    const entry: UITypes.CourseDetailsExercise = {
      id: exerciseId,
      name,
      passed:
        LocalCourseData.getExercises(course).find(
          (ce) =>
            ExerciseIdentifier.toString(LocalCourseExercise.getId(ce)) ===
            ExerciseIdentifier.toString(exerciseId),
        )?.data.passed || false,
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

  const exerciseGroups: ExerciseGroup[] = Array.from(groupsByName.values())
    .toSorted((a, b) => (a.name > b.name ? 1 : -1))
    .map((e) => ({
      name: e.name,
      exercises: e.exercises.toSorted((a, b) => (a.name > b.name ? 1 : -1)),
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

function mapStatus(status: ExerciseStatus, expired: boolean): UITypes.ExerciseStatus {
  switch (status) {
    case ExerciseStatus.Closed:
      return "closed"
    case ExerciseStatus.Open:
      return "opened"
    default:
      return expired ? "expired" : "new"
  }
}
