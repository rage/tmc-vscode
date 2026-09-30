import type { WorkspaceExercise } from "../api/workspaceManager"
import type {
  ExerciseGroup,
  ExerciseIdentifier,
  ExerciseStatus as PanelExerciseStatus,
} from "../shared/shared"
import { LocalCourseData, LocalCourseExercise } from "../shared/shared"
import { buildCourseView, exerciseKey, shownDeadline } from "../ui/treeview/courseViewModel"
import { formatDeadline, parseNextDeadlineAfter } from "../utilities"

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
  const parts = buildCourseView(course, { workspaceExercises, inFlight: [], updateable: [], now })
  const formatDate = (date: Date | null): string => (date ? formatDeadline(date, now, locale) : "-")
  const statusByKey = new Map(
    parts.flatMap((part) => part.exercises.map((ex) => [exerciseKey(ex.id), ex.status] as const)),
  )
  return {
    exerciseStatuses: LocalCourseData.getExercises(course).map((ex) => {
      const exerciseId = LocalCourseExercise.getId(ex)
      return { exerciseId, status: statusByKey.get(exerciseKey(exerciseId)) ?? "missing" }
    }),
    exerciseGroups: parts.map((part) => ({
      name: part.name,
      exercises: part.exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        passed: ex.passed,
        softDeadlineString: formatDate(ex.softDeadline),
        hardDeadlineString: formatDate(ex.hardDeadline),
        deadlineIso: shownDeadline(ex)?.toISOString() ?? null,
        isHard: ex.isHard,
      })),
      nextDeadlineString: offlineMode
        ? "Next deadline: Not available"
        : parseNextDeadlineAfter(
            now,
            part.exercises.map((ex) => ({ date: shownDeadline(ex), active: !ex.passed })),
            locale,
          ),
      defaultOpen: part.isDefaultOpen,
    })),
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
