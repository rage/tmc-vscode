import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"
import { z } from "zod"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseStatus } from "../api/workspaceManager"
import { InitializationError } from "../errors"
import { assertUnreachable } from "../shared/shared"
import { Logger } from "../utilities"
import type { ActionContext } from "./types"

const closedExercisesSettingSchema = z.array(z.string()).nullable()

const isClosedExercisesSetting = (object: unknown): object is string[] | null =>
  closedExercisesSettingSchema.safeParse(object).success

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

  const workspaceExercises: WorkspaceExercise[] = []
  for (const course of userData.val.getCourses()) {
    switch (course.kind) {
      case "tmc": {
        const exercisesResult = await langs.val.listLocalCourseExercises("tmc", course.data.name)
        if (exercisesResult.err) {
          Logger.warn(
            `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
            exercisesResult.val,
          )
          continue
        }

        const closedExercisesResult = (
          await langs.val.getSetting(
            `closed-exercises-for:${course.data.name}`,
            isClosedExercisesSetting,
          )
        ).mapErr((e) => {
          Logger.warn("Failed to determine closed status for exercises, defaulting to open.", e)
          return []
        })

        const closedExercises = new Set(closedExercisesResult.val ?? [])
        workspaceExercises.push(
          ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
            backend: "tmc",
            courseSlug: course.data.name,
            exerciseSlug: x["exercise-slug"],
            status: closedExercises.has(x["exercise-slug"])
              ? ExerciseStatus.Closed
              : ExerciseStatus.Open,
            uri: vscode.Uri.file(x["exercise-path"]),
          })),
        )
        break
      }
      case "mooc": {
        const exercisesResult = await langs.val.listLocalCourseExercises("mooc", course.data.name)
        if (exercisesResult.err) {
          Logger.warn(
            `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
            exercisesResult.val,
          )
          continue
        }

        const closedExercisesResult = (
          await langs.val.getSetting(
            `closed-exercises-for:${course.data.name}`,
            isClosedExercisesSetting,
          )
        ).mapErr((e) => {
          Logger.warn("Failed to determine closed status for exercises, defaulting to open.", e)
          return []
        })

        const closedExercises = new Set(closedExercisesResult.val ?? [])
        workspaceExercises.push(
          ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
            backend: "mooc",
            courseSlug: course.data.name,
            exerciseSlug: x["exercise-slug"],
            status: closedExercises.has(x["exercise-slug"])
              ? ExerciseStatus.Closed
              : ExerciseStatus.Open,
            uri: vscode.Uri.file(x["exercise-path"]),
          })),
        )
        break
      }
      default: {
        assertUnreachable(course)
      }
    }
  }

  return workspaceManager.val.setExercises(workspaceExercises)
}
