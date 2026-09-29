import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { checkForExerciseUpdates, downloadExerciseUpdates } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { NOTIFICATION_DELAY } from "../config/constants"
import { CourseIdentifier } from "../shared/shared"
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
  if (!silent) {
    for (const { backend, error } of failures) {
      void dialog.reportError("Failed to check for exercise updates.", error, backend)
    }
  }

  const now = Date.now()
  const exercisesToUpdate = outdated.filter((x) => {
    const course = userData.getCourse(x.courseId)
    return course.ok && course.val.data.notifyAfter <= now && !course.val.data.disabled
  })

  if (exercisesToUpdate.length === 0) {
    if (!silent && failures.length === 0) {
      void dialog.notification("All exercises are up to date.")
    }
    return
  }

  // Keyed by canonical string because each `courseId` is a fresh object, so
  // anything comparing them by reference sees every exercise as its own course.
  const coursesToUpdate = new Map(
    exercisesToUpdate.map((x) => [CourseIdentifier.toString(x.courseId), x.courseId]),
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
    `Found updates for ${exercisesToUpdate.length} exercises. Do you wish to download them?`,
    ["Download", (): void => void download()],
    [
      "Remind me later",
      (): void =>
        void withOperation(dialog, { failure: "Failed to postpone the reminder." }, postpone),
    ],
  )
}
