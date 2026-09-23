import * as os from "os"

import { compact } from "lodash"
import type { Result } from "ts-results"
import { Ok } from "ts-results"
import type * as vscode from "vscode"

import { ExerciseStatus } from "../api/workspaceManager"
import { nextPanelId, TmcPanel } from "../panels/TmcPanel"
import type { CourseDetailsPanel, CourseIdentifier, ExtensionToWebview } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise, match } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadExercisesForUi } from "./downloadExercisesForUi"
import type { ReadyActionContext } from "./types"

/**
 * Total RAM, not free RAM: the open-exercise warning is about how many folders the file
 * watcher and explorer can keep up with on this machine, not about what is free right now.
 */
const UNDER_8GB_RAM = os.totalmem() < 8 * 1024 ** 3

/**
 * Opens given exercises, showing them in the course workspace.
 * @param exerciseIdsToOpen Array of exercise IDs
 */
export async function openExercises(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exerciseIdsToOpen: ExerciseIdentifier[],
  courseId: CourseIdentifier,
): Promise<Result<ExerciseIdentifier[], Error>> {
  Logger.info("Opening exercises", exerciseIdsToOpen)

  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercises = new Map(LocalCourseData.getExercises(course).map((x) => [x.data.id, x]))
  const exercisesToOpen = compact(
    exerciseIdsToOpen.map((x) => courseExercises.get(ExerciseIdentifier.unwrap(x))),
  )

  const courseName = match(
    course,
    (tmc) => tmc.name,
    (mooc) => mooc.name,
  )
  const openResult = await workspaceManager.openCourseExercises(
    course.kind,
    courseName,
    exercisesToOpen.map((x) => LocalCourseExercise.getSlug(x)),
  )
  if (openResult.err) {
    return openResult
  }

  // check open exercise count and warn if it's too high
  const weakThreshold = 50
  const strongThreshold = 100
  const warningThreshold = UNDER_8GB_RAM ? weakThreshold : strongThreshold
  const currentlyOpen = workspaceManager
    .getExercisesByCourseSlug(course.kind, courseName)
    .filter((x) => x.status === ExerciseStatus.Open)
  if (currentlyOpen.length > warningThreshold) {
    dialog.warningNotification(
      `You have over ${warningThreshold} exercises open, which may cause performance issues. You can close completed exercises from the TMC extension menu in the sidebar.`,
      [
        "Open course details",
        (): void => {
          const panel: CourseDetailsPanel = {
            id: nextPanelId(),
            type: "CourseDetails",
            courseId,
            exerciseStatuses: {
              tmc: {},
              mooc: {},
            },
          }
          TmcPanel.renderMain(context.extensionUri, context, actionContext, panel)
        },
      ],
    )
  }

  TmcPanel.postMessage(
    ...exerciseIdsToOpen.map<ExtensionToWebview>((id) => ({
      type: "exerciseStatusChange",
      courseId,
      exerciseId: id,
      status: "opened",
      target: {
        type: "CourseDetails",
      },
    })),
  )

  return new Ok(exerciseIdsToOpen)
}

/**
 * Opens given exercises, first downloading any of them that are not present locally.
 *
 * This is what the webview's "open exercises" action maps to: the user can check an
 * exercise that has never been downloaded, so opening it has to fetch it first.
 */
export async function downloadAndOpenExercises(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exerciseIdsToOpen: ExerciseIdentifier[],
  courseId: CourseIdentifier,
): Promise<Result<ExerciseIdentifier[], Error>> {
  const { dialog } = actionContext
  const { langs, userData } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  // Key by a primitive: ExerciseIdentifier is a tagged-union object, so a
  // Map keyed by it would only match on reference identity and always miss
  // the deserialized ids coming from the webview.
  const courseExercises = new Map(
    LocalCourseData.getExercises(course).map((x) => [
      ExerciseIdentifier.toString(LocalCourseExercise.getId(x)),
      x,
    ]),
  )
  const exercisesToOpen = compact(
    exerciseIdsToOpen.map((x) => courseExercises.get(ExerciseIdentifier.toString(x))),
  )
  // The mooc local listing is keyed by course id (UUID); TMC by course
  // slug. `getCourseName` returns the slug for both, so pick per backend.
  const localCourseExercises = await langs.listLocalCourseExercises(
    courseId.kind,
    match(
      course,
      () => LocalCourseData.getCourseName(course),
      (mooc) => mooc.id,
    ),
  )
  if (localCourseExercises.err) {
    dialog.reportError(
      "Error trying to list local exercises while opening selected exercises.",
      localCourseExercises.val,
      courseId.kind,
    )
    return localCourseExercises
  }

  const localExerciseIds = new Set<number | string>(
    localCourseExercises.val.map((lce) => lce["exercise-id"]),
  )
  const exercisesToDownload = exercisesToOpen.filter(
    (eto) => !localExerciseIds.has(ExerciseIdentifier.unwrap(LocalCourseExercise.getId(eto))),
  )
  if (exercisesToDownload.length > 0) {
    await downloadExercisesForUi(
      actionContext,
      "",
      courseId,
      exercisesToDownload.map((etd) => LocalCourseExercise.getId(etd)),
    )
  }

  // `openExercises` is responsible for posting the resulting "opened" status
  // changes back to the webview, so don't duplicate that here.
  const openResult = await openExercises(context, actionContext, exerciseIdsToOpen, courseId)
  if (openResult.err) {
    dialog.reportError("Errored while opening selected exercises.", openResult.val, courseId.kind)
  }
  return openResult
}
