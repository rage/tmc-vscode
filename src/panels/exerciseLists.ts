import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { TmcPanel } from "./TmcPanel"
import { updateablesRegistry } from "./updateablesRegistry"

/**
 * Records `exerciseIds` as `courseId`'s updateable exercises **and** posts them.
 *
 * The single writer: recording and posting separately would let the two drift, and a
 * reload would then restore a list the live UI never showed.
 */
export function postUpdateables(
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): void {
  updateablesRegistry.set(courseId, exerciseIds)
  TmcPanel.postMessage({
    type: "setUpdateables",
    target: { type: "CourseDetails" },
    courseId,
    exerciseIds,
  })
}

/**
 * Empties a webview list while `body` runs, then always fills it back in.
 *
 * The lists the panels show are cleared before the download they describe starts, so
 * the student sees the work begin. `restore` runs from a `finally`, so a `body` that
 * fails or throws cannot leave them looking at an empty list and conclude there is
 * nothing left to download.
 *
 * @param restore receives `body`'s value, or `undefined` if it threw.
 */
export async function withOptimisticList<T>(
  clear: () => void,
  body: () => Promise<T>,
  restore: (outcome: T | undefined) => void,
): Promise<T> {
  clear()
  let outcome: T | undefined
  try {
    outcome = await body()
    return outcome
  } finally {
    restore(outcome)
  }
}
