import type { CourseIdentifier, ExerciseIdentifier, ExerciseStatus } from "../shared/shared"
import { exerciseStatusRegistry } from "./exerciseStatusRegistry"
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
 * Records `courseId`'s exercise statuses **and** posts them to the CourseDetails panels,
 * one message however many there are.
 *
 * The single writer, for the reason given on {@link postUpdateables}.
 */
export function postExerciseStatuses(
  courseId: CourseIdentifier,
  statuses: [ExerciseIdentifier, ExerciseStatus][],
): void {
  if (statuses.length === 0) {
    return
  }
  exerciseStatusRegistry.record(courseId, statuses)
  TmcPanel.postMessage({
    type: "setExerciseStatuses",
    target: { type: "CourseDetails" },
    courseId,
    statuses,
  })
}

/** {@link postExerciseStatuses} for a single exercise, as it settles mid-download. */
export function postExerciseStatus(
  courseId: CourseIdentifier,
  exerciseId: ExerciseIdentifier,
  status: ExerciseStatus,
): void {
  exerciseStatusRegistry.record(courseId, [[exerciseId, status]])
  TmcPanel.postMessage({
    type: "exerciseStatusChange",
    target: { type: "CourseDetails" },
    courseId,
    exerciseId,
    status,
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
