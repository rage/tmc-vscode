import * as os from "os"

import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { CourseIdentifier } from "../../shared/lib"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise } from "../../shared/lib"
import type { OperationWarning, Warned } from "../api/withOperation"
import { logWarnings } from "../api/withOperation"
import { ExerciseStatus } from "../api/workspaceManager"
import { Logger } from "../utilities"
import { downloadCourseExercises } from "./downloadCourseExercises"
import type { DownloadProgressPlace } from "./downloadOrUpdateExercises"
import type { ReadyActionContext } from "./types"

/** Total RAM, not free: the warning is about what the file watcher and explorer can handle. */
const UNDER_8GB_RAM = os.totalmem() < 8 * 1024 ** 3

/** What {@link openExercises} opened, and whether the course now has too many open. */
export interface OpenedExercises {
  /** The requested exercises that are on disk, and so were opened. */
  ids: ExerciseIdentifier[]
  /** The machine's open-exercise limit, when the course now has more open; the caller warns. */
  exceededOpenLimit: number | undefined
}

/** Opens exercises already on disk; {@link downloadAndOpenExercises} fetches missing ones first. */
export async function openExercises(
  actionContext: ReadyActionContext,
  exerciseIdsToOpen: ExerciseIdentifier[],
  courseId: CourseIdentifier,
): Promise<Result<OpenedExercises, Error>> {
  Logger.info("Opening exercises", exerciseIdsToOpen)

  const { userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseName = LocalCourseData.getCourseName(course)
  const openResult = await workspaceManager.openCourseExercises(
    course.kind,
    courseName,
    exerciseIdsToOpen,
  )
  if (openResult.err) {
    return openResult
  }
  // An exercise not on disk, say one whose download just failed, is not among them.
  const openedIds = openResult.val.map((x) => x.id)

  const openLimit = UNDER_8GB_RAM ? 50 : 100
  const openCount = workspaceManager
    .getExercisesByCourseSlug(course.kind, courseName)
    .filter((x) => x.status === ExerciseStatus.Open).length

  return new Ok({
    ids: openedIds,
    exceededOpenLimit: openCount > openLimit ? openLimit : undefined,
  })
}

/**
 * Opens given exercises, first downloading any not present locally: the Courses view offers
 * Open on exercises never downloaded.
 */
export async function downloadAndOpenExercises(
  actionContext: ReadyActionContext,
  exerciseIdsToOpen: ExerciseIdentifier[],
  courseId: CourseIdentifier,
  progressPlace?: DownloadProgressPlace,
): Promise<Result<OpenedExercises & Warned, Error>> {
  const { userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const courseExerciseKeys = new Set(
    LocalCourseData.getExercises(courseResult.val).map((x) =>
      ExerciseIdentifier.key(LocalCourseExercise.getId(x)),
    ),
  )
  const warnings: OperationWarning[] = []
  const exercisesToDownload = exerciseIdsToOpen.filter(
    (id) => courseExerciseKeys.has(ExerciseIdentifier.key(id)) && !workspaceManager.getExercise(id),
  )
  if (exercisesToDownload.length > 0) {
    const downloaded = await downloadCourseExercises(
      actionContext,
      courseId,
      exercisesToDownload,
      progressPlace,
    )
    if (downloaded.err) {
      return downloaded
    }
    warnings.push(...downloaded.val.warnings)
  }

  const opened = await openExercises(actionContext, exerciseIdsToOpen, courseId)
  if (opened.err) {
    logWarnings(warnings)
    return opened
  }
  return Ok({ ...opened.val, warnings })
}
