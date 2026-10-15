import { Ok } from "ts-results"

import type { CourseIdentifier, ExerciseIdentifier } from "../../../shared/lib"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
  LocalCourseData,
  LocalCourseExercise,
} from "../../../shared/lib"
import {
  closeExercises as closeExercisesAction,
  downloadAndOpenExercises,
  downloadCourseExercises,
  downloadExerciseUpdates,
} from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { withOperation } from "../../api/withOperation"
import { ExerciseStatus } from "../../api/workspaceManager"
import { countOf } from "../../utilities"
import { showExerciseSourceFile } from "../exerciseSourceFile"
import { updateablesRegistry } from "../updateablesRegistry"
import type { CoursesTreeItem } from "./treeview"
import { ExerciseTreeItem, exerciseItems, isDownloadable } from "./treeview"

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

/**
 * Downloads the exercises among `rows`, and under them, that are not on disk yet. A single
 * exercise row also gets its main source file shown.
 */
export async function downloadExercises(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  for (const { courseId, ids } of byCourse(rows, (item) => isDownloadable(item.status))) {
    await withOperation(
      actionContext.dialog,
      { failure: "Failed to download the exercises." },
      () => downloadCourseExercises(actionContext, courseId, ids),
    )
  }
  await showSourceFileOfOnlyExercise(actionContext, rows)
}

/**
 * Opens the exercises among `rows`, and under them, downloading any that are not on disk. A
 * single exercise row also gets its main source file shown, which is what clicking one does.
 */
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
    const opened = await withOperation(dialog, { failure: "Failed to open the exercises." }, () =>
      downloadAndOpenExercises(actionContext, ids, courseId),
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
  await showSourceFileOfOnlyExercise(actionContext, rows)
}

/** Shows the main source file of the exercise when `rows` is one exercise row now on disk. */
async function showSourceFileOfOnlyExercise(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  const [only, ...others] = rows
  if (only instanceof ExerciseTreeItem && others.length === 0) {
    const exercise = actionContext.startup.workspaceManager.getExercise(only.exerciseId)
    if (exercise) {
      await showExerciseSourceFile(actionContext, exercise)
    }
  }
}

/** Closes the open exercises among `rows`, and under them. */
export async function closeExercises(
  actionContext: ReadyActionContext,
  rows: CoursesTreeItem[],
): Promise<void> {
  for (const { courseId, ids } of byCourse(rows, (item) => item.status === "opened")) {
    await withOperation(actionContext.dialog, { failure: "Failed to close the exercises." }, () =>
      closeExercisesAction(actionContext, ids, courseId),
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
  await withOperation(dialog, { failure: "Failed to close the completed exercises." }, async () => {
    const course = userData.getCourse(courseId)
    if (course.err) {
      return course
    }
    const courseName = LocalCourseData.getCourseName(course.val)
    const passed = new Set(
      LocalCourseData.getExercises(course.val)
        .filter((ex) => ex.data.passed)
        .map((ex) => ExerciseIdentifierNs.key(LocalCourseExercise.getId(ex))),
    )
    const ids: ExerciseIdentifier[] = workspaceManager
      .getExercisesByCourseSlug(course.val.kind, courseName)
      .filter(
        (ex) => ex.status === ExerciseStatus.Open && passed.has(ExerciseIdentifierNs.key(ex.id)),
      )
      .map((ex) => ex.id)
    if (ids.length === 0) {
      dialog.statusMessage("No completed exercises are open.")
      return Ok.EMPTY
    }
    const closed = await closeExercisesAction(actionContext, ids, courseId)
    if (closed.err) {
      return closed
    }
    dialog.statusMessage(`Closed ${countOf(closed.val.length, "completed exercise")}.`)
    return Ok.EMPTY
  })
}

/**
 * Downloads the updates the last check found for the course's exercises, or for the one
 * exercise when `row` is an exercise's.
 */
export async function updateCourseExercises(
  actionContext: ReadyActionContext,
  row: CoursesTreeItem,
): Promise<void> {
  const { courseId } = row
  const exerciseIds =
    row instanceof ExerciseTreeItem ? [row.exerciseId] : updateablesRegistry.get(courseId)
  await withOperation(actionContext.dialog, { failure: "Failed to update the exercises." }, () =>
    downloadExerciseUpdates(
      actionContext,
      exerciseIds.map((exerciseId) => ({ courseId, exerciseId })),
    ),
  )
}

/** Stops announcing the course's new exercises, without downloading them. */
export async function dismissNewExercises(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<void> {
  await withOperation(
    actionContext.dialog,
    { failure: "Failed to dismiss the new exercises." },
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
    course.ids.set(ExerciseIdentifierNs.key(item.exerciseId), item.exerciseId)
    courses.set(courseKey, course)
  }
  return [...courses.values()].map(({ courseId, ids }) => ({ courseId, ids: [...ids.values()] }))
}
