import * as os from "os"

import { compact } from "lodash"
import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { ExerciseStatus } from "../api/workspaceManager"
import type { CourseIdentifier } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise, match } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadExercisesForUi } from "./downloadExercisesForUi"
import type { ReadyActionContext } from "./types"

/**
 * Total RAM, not free RAM: the open-exercise warning is about how many folders the file
 * watcher and explorer can keep up with on this machine, not about what is free right now.
 */
const UNDER_8GB_RAM = os.totalmem() < 8 * 1024 ** 3

/** What {@link openExercises} opened, and whether the course now has too many open. */
export interface OpenedExercises {
  /** The requested exercises that are on disk, and so were opened. */
  ids: ExerciseIdentifier[]
  /**
   * The open-exercise limit this machine is warned at, when the course's open count now
   * exceeds it; the caller tells the user.
   */
  exceededOpenLimit: number | undefined
}

/**
 * Opens given exercises, showing them in the course workspace.
 * @param exerciseIdsToOpen Array of exercise IDs
 */
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
  // An exercise not on disk, say one whose download just failed, is not among them.
  const openedSlugs = new Set(openResult.val.map((x) => x.exerciseSlug))
  const openedIds = exercisesToOpen
    .filter((x) => openedSlugs.has(LocalCourseExercise.getSlug(x)))
    .map((x) => LocalCourseExercise.getId(x))

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
 * Opens given exercises, first downloading any of them that are not present locally.
 *
 * The Courses view offers Open on an exercise that has never been downloaded, so opening
 * it has to fetch it first.
 */
export async function downloadAndOpenExercises(
  actionContext: ReadyActionContext,
  exerciseIdsToOpen: ExerciseIdentifier[],
  courseId: CourseIdentifier,
): Promise<Result<OpenedExercises, Error>> {
  const { langs, userData } = actionContext.startup

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercises = new Map(
    LocalCourseData.getExercises(course).map((x) => [
      ExerciseIdentifier.key(LocalCourseExercise.getId(x)),
      x,
    ]),
  )
  const exercisesToOpen = compact(
    exerciseIdsToOpen.map((x) => courseExercises.get(ExerciseIdentifier.key(x))),
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
      "download",
      courseId,
      exercisesToDownload.map((etd) => LocalCourseExercise.getId(etd)),
    )
  }

  return openExercises(actionContext, exerciseIdsToOpen, courseId)
}
