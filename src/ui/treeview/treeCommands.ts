import { Ok } from "ts-results"

import {
  closeExercises as closeExercisesAction,
  downloadAndOpenExercises,
  downloadExercisesForUi,
} from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { withOperation } from "../../api/withOperation"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  LocalCourseData,
  LocalCourseExercise,
} from "../../shared/shared"
import { updateablesRegistry } from "../updateablesRegistry"
import type { CoursesTreeItem, ExerciseTreeItem } from "./treeview"
import { exerciseItems, isDownloadable } from "./treeview"

/**
 * The rows a Courses view command acts on: the whole selection when the clicked row is part
 * of it, else the clicked row alone, which is what VS Code's own views do.
 *
 * @param clicked The row the command was invoked on; `undefined` from the palette.
 * @param selection Every selected row, as VS Code passes it to a `canSelectMany` view's commands.
 */
export function targetRows(
  clicked: CoursesTreeItem | undefined,
  selection: readonly CoursesTreeItem[] | undefined,
): CoursesTreeItem[] {
  if (!clicked) {
    return []
  }
  return selection?.includes(clicked) ? [...selection] : [clicked]
}

/** Downloads the exercises among `rows`, and under them, that are not on disk yet. */
export async function downloadExercises(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  for (const { courseId, ids } of byCourse(rows, (item) => isDownloadable(item.status))) {
    await withOperation(
      actionContext.dialog,
      { failure: "Failed to download the exercises.", backend: courseId.kind },
      () => downloadExercisesForUi(actionContext, "download", courseId, ids),
    )
  }
}

/** Opens the exercises among `rows`, and under them, downloading any that are not on disk. */
export async function openExercises(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  const { dialog } = actionContext
  const selected = byCourse(
    rows,
    (item) => item.status !== "opened" && item.status !== "downloading",
  )
  for (const { courseId, ids } of selected) {
    const opened = await withOperation(
      dialog,
      { failure: "Failed to open the exercises.", backend: courseId.kind },
      () => downloadAndOpenExercises(actionContext, ids, courseId),
    )
    const openLimit = opened.ok ? opened.val.exceededOpenLimit : undefined
    if (openLimit !== undefined) {
      void dialog.warningNotification(
        `You have over ${openLimit} exercises open, which can slow VS Code down. Close the ones you have finished.`,
        [
          "Close Completed Exercises",
          (): void => void closeCompletedExercises(actionContext, courseId),
        ],
      )
    }
  }
}

/** Closes the open exercises among `rows`, and under them. */
export async function closeExercises(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  for (const { courseId, ids } of byCourse(rows, (item) => item.status === "opened")) {
    await withOperation(
      actionContext.dialog,
      { failure: "Failed to close the exercises.", backend: courseId.kind },
      () => closeExercisesAction(actionContext, ids, courseId),
    )
  }
}

/** Closes every open exercise of the course that has been passed. */
export async function closeCompletedExercises(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<void> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  await withOperation(
    dialog,
    { failure: "Failed to close the completed exercises.", backend: courseId.kind },
    async () => {
      const course = userData.getCourse(courseId)
      if (course.err) {
        return course
      }
      const courseName = LocalCourseData.getCourseName(course.val)
      const openSlugs = new Set(
        workspaceManager
          .getExercisesByCourseSlug(course.val.kind, courseName)
          .filter((ex) => ex.status === ExerciseStatus.Open)
          .map((ex) => ex.exerciseSlug),
      )
      const ids: ExerciseIdentifier[] = LocalCourseData.getExercises(course.val)
        .filter((ex) => ex.data.passed && openSlugs.has(LocalCourseExercise.getSlug(ex)))
        .map((ex) => LocalCourseExercise.getId(ex))
      if (ids.length === 0) {
        dialog.statusMessage("No completed exercises are open.")
        return Ok.EMPTY
      }
      const closed = await closeExercisesAction(actionContext, ids, courseId)
      if (closed.err) {
        return closed
      }
      const count = closed.val.length
      dialog.statusMessage(`Closed ${count} completed ${count === 1 ? "exercise" : "exercises"}.`)
      return Ok.EMPTY
    },
  )
}

/** Downloads the updates the last check found for the course's exercises. */
export async function updateCourseExercises(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<void> {
  await withOperation(
    actionContext.dialog,
    { failure: "Failed to update the exercises.", backend: courseId.kind },
    () =>
      downloadExercisesForUi(actionContext, "update", courseId, updateablesRegistry.get(courseId)),
  )
}

/** Stops announcing the course's new exercises, without downloading them. */
export async function dismissNewExercises(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<void> {
  await withOperation(
    actionContext.dialog,
    { failure: "Failed to dismiss the new exercises.", backend: courseId.kind },
    () => actionContext.startup.userData.clearFromNewExercises(courseId),
  )
}

/** The exercises under `rows` that `isWanted`, grouped by course, each exercise once. */
function byCourse(
  rows: CoursesTreeItem[],
  isWanted: (item: ExerciseTreeItem) => boolean,
): { courseId: CourseIdentifier; ids: ExerciseIdentifier[] }[] {
  const courses = new Map<
    string,
    { courseId: CourseIdentifier; ids: Map<string, ExerciseIdentifier> }
  >()
  for (const item of rows.flatMap((row) => exerciseItems(row))) {
    if (!isWanted(item)) {
      continue
    }
    const courseKey = CourseIdentifierNs.key(item.courseId)
    const course = courses.get(courseKey) ?? { courseId: item.courseId, ids: new Map() }
    course.ids.set(item.id ?? "", item.exerciseId)
    courses.set(courseKey, course)
  }
  return [...courses.values()].map(({ courseId, ids }) => ({ courseId, ids: [...ids.values()] }))
}
