import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"
import { z } from "zod"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseStatus } from "../api/workspaceManager"
import { closedExercisesSettingKey } from "../config/constants"
import { InitializationError } from "../errors"
import type { LocalExercise } from "../shared/langsSchema"
import { LocalCourseData, match } from "../shared/shared"
import { Logger } from "../utilities"
import type { ActionContext } from "./types"

const closedExercisesSettingSchema = z.array(z.string()).nullable()

function readClosedExercises(settings: Record<string, unknown>, key: string): string[] {
  const parsed = closedExercisesSettingSchema.safeParse(settings[key] ?? null)
  if (!parsed.success) {
    Logger.warn(`Ignoring a malformed ${key} setting; its exercises default to open.`)
    return []
  }
  return parsed.data ?? []
}

/**
 * Asks for all local exercises from TMC-Langs and passes them to WorkspaceManager.
 */
export async function refreshLocalExercises(
  actionContext: ActionContext,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Refreshing local exercises")

  const [localExercisesResult, settingsResult] = await Promise.all([
    langs.val.listLocalExercises(),
    langs.val.listSettings(),
  ])
  if (localExercisesResult.err) {
    return localExercisesResult
  }
  if (settingsResult.err) {
    Logger.warn(
      "Failed to determine closed status for exercises, defaulting to open.",
      settingsResult.val,
    )
  }
  const settings = settingsResult.ok ? settingsResult.val : {}

  // Keyed the way the user's catalogue identifies a course: TMC by slug, mooc by id,
  // since a mooc course's on-disk slug is derived locally and need not match its name.
  const localExercisesByCourse = new Map<string, LocalExercise[]>()
  for (const exercise of localExercisesResult.val) {
    const key = exercise.backend === "tmc" ? exercise["course-slug"] : exercise["course-id"]
    const exercises = localExercisesByCourse.get(key)
    if (exercises) {
      exercises.push(exercise)
    } else {
      localExercisesByCourse.set(key, [exercise])
    }
  }

  const workspaceExercises: WorkspaceExercise[] = []
  for (const course of userData.val.getCourses()) {
    const courseSlug = LocalCourseData.getCourseName(course)
    const localExercises = localExercisesByCourse.get(
      match(
        course,
        () => courseSlug,
        (mooc) => mooc.id,
      ),
    )
    if (!localExercises) {
      continue
    }

    const closedExercises = new Set(
      readClosedExercises(settings, closedExercisesSettingKey(course.kind, courseSlug)),
    )

    workspaceExercises.push(
      ...localExercises.map<WorkspaceExercise>((x) => ({
        backend: x.backend,
        courseSlug,
        exerciseSlug: x["exercise-slug"],
        status: closedExercises.has(x["exercise-slug"])
          ? ExerciseStatus.Closed
          : ExerciseStatus.Open,
        uri: vscode.Uri.file(x["exercise-path"]),
      })),
    )
  }

  return workspaceManager.val.setExercises(workspaceExercises)
}
