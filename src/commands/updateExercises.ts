import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { checkForExerciseUpdates, downloadExerciseUpdates } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { NOTIFICATION_DELAY } from "../config/constants"
import { backendName, CourseIdentifier, LocalCourseData } from "../shared/shared"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { Logger } from "../utilities"

/**
 * Downloads pending exercise updates, or offers to.
 *
 * `"silent"` is for runs the user did not ask for — activation, the background poll,
 * the refresh after a submit. It suppresses the "up to date" toast and the failure
 * notification but deliberately not the "Found updates" prompt, which together with
 * its "Remind me later" postponement is the only thing that reaches a user who has
 * turned automatic updates off.
 */
export async function updateExercises(
  actionContext: ReadyActionContext,
  mode?: "silent" | "loud",
): Promise<void> {
  const { dialog, settings } = actionContext
  const { userData } = actionContext.startup
  const silent = mode === "silent"
  Logger.info("Checking for exercise updates")

  const updateablesResult = await withOperation(
    dialog,
    { failure: "Failed to check for exercise updates.", silent },
    async () => Ok(await checkForExerciseUpdates(actionContext)),
  )
  if (updateablesResult.err) {
    return
  }

  const { outdated, failures } = updateablesResult.val
  // What a failed backend's courses last showed is still the best answer for them.
  updateablesRegistry.setMany(
    userData
      .getCourses()
      .filter((course) => failures.every(({ backend }) => backend !== course.kind))
      .map((course) => {
        const courseId = LocalCourseData.getCourseId(course)
        return [
          courseId,
          outdated
            .filter((x) => CourseIdentifier.equals(x.courseId, courseId))
            .map((x) => x.exerciseId),
        ]
      }),
  )
  const [firstFailure] = failures
  if (!silent && firstFailure) {
    // One notification however many sites failed; the log has each one's error.
    const sites = failures.map(({ backend }) => backendName(backend)).join(" and ")
    for (const { backend, error } of failures.slice(1)) {
      Logger.error(`Failed to check ${backendName(backend)} for exercise updates.`, error)
    }
    void dialog.reportError(
      `Failed to check ${sites} for exercise updates.`,
      firstFailure.error,
      failures.length === 1 ? firstFailure.backend : undefined,
    )
  }

  const now = Date.now()
  const exercisesToUpdate = outdated.filter((x) => {
    const course = userData.getCourse(x.courseId)
    return course.ok && course.val.data.notifyAfter <= now && !course.val.data.disabled
  })

  if (exercisesToUpdate.length === 0) {
    if (!silent && failures.length === 0) {
      dialog.statusMessage("All exercises are up to date.")
    }
    return
  }

  // Each `courseId` is a fresh object, so only a key tells two of them are one course.
  const coursesToUpdate = new Map(
    exercisesToUpdate.map((x) => [CourseIdentifier.key(x.courseId), x.courseId]),
  )

  const download = async (): Promise<void> => {
    await withOperation(dialog, { failure: "Failed to update exercises." }, async () => {
      await downloadExerciseUpdates(actionContext, exercisesToUpdate)
      return Ok.EMPTY
    })
  }

  if (settings.getAutomaticallyUpdateExercises()) {
    return download()
  }

  const postpone = async (): Promise<Result<void, Error>> => {
    const notifyAfter = Date.now() + NOTIFICATION_DELAY
    for (const courseId of coursesToUpdate.values()) {
      const result = await userData.setNewExerciseNotifyAfter(courseId, notifyAfter)
      if (result.err) {
        return result
      }
    }
    return Ok.EMPTY
  }

  void dialog.notification(
    exercisesToUpdate.length === 1
      ? "1 exercise has an update. Download it now?"
      : `${exercisesToUpdate.length} exercises have updates. Download them now?`,
    ["Download", (): void => void download()],
    [
      "Remind Me Later",
      (): void =>
        void withOperation(dialog, { failure: "Failed to postpone the reminder." }, postpone),
    ],
  )
}
