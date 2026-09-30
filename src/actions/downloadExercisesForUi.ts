import { Ok, Result } from "ts-results"

import { withOptimisticList } from "../panels/exerciseLists"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads exercises and rescans the disk, so the Courses view shows the result.
 *
 * `"update"` works through the course's updates and keeps the ones that failed listed;
 * `"download"` takes the downloaded exercises off the course's new-exercise list. Errs, with
 * nothing downloaded, only while some of the exercises are already downloading.
 */
export async function downloadExercisesForUi(
  actionContext: ReadyActionContext,
  mode: "download" | "update",
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  const reportRefreshFailure = (refreshResult: Result<unknown, Error>): void => {
    if (refreshResult.err) {
      dialog.reportError("Failed to refresh local exercises.", refreshResult.val, courseId.kind)
    }
  }

  if (mode === "update") {
    const shownBeforeDownload = updateablesRegistry.get(courseId)
    return withOptimisticList(
      () => updateablesRegistry.set(courseId, []),
      async (): Promise<Result<ExerciseIdentifier[], Error>> => {
        const downloaded = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
        if (downloaded.err) {
          return downloaded
        }
        reportRefreshFailure(await refreshLocalExercises(actionContext))
        return Ok(downloaded.val.failed)
      },
      (outcome) =>
        updateablesRegistry.set(courseId, outcome?.ok ? outcome.val : shownBeforeDownload),
    ).then((outcome) => outcome.map(() => undefined))
  }

  const downloaded = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
  if (downloaded.err) {
    return downloaded
  }
  reportRefreshFailure(
    Result.all(
      await userData.clearFromNewExercises(courseId, downloaded.val.successful),
      await refreshLocalExercises(actionContext),
    ),
  )
  return Ok.EMPTY
}
