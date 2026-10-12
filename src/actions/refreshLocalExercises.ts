import type { Result } from "ts-results"
import * as vscode from "vscode"
import { z } from "zod"

import type { LocalExercise } from "../../shared/langsSchema"
import type { ExerciseIdentifier } from "../../shared/lib"
import { LocalCourseData, makeMoocKind, makeTmcKind, match } from "../../shared/lib"
import type Langs from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { ExerciseStatus } from "../api/workspaceManager"
import { closedExercisesSettingKey } from "../config/constants"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

const closedExercisesSettingSchema = z.array(z.string()).nullable()

function readClosedExercises(settings: Record<string, unknown>, key: string): string[] {
  const parsed = closedExercisesSettingSchema.safeParse(settings[key] ?? null)
  if (!parsed.success) {
    Logger.warn(`Ignoring a malformed ${key} setting; its exercises default to open.`)
    return []
  }
  return parsed.data ?? []
}

/** What {@link refreshLocalExercises} reads from the CLI: the exercises on disk and the settings. */
export interface LocalExerciseScan {
  localExercises: Result<LocalExercise[], Error>
  settings: Awaited<ReturnType<Langs["listSettings"]>>
}

/** Reads a {@link LocalExerciseScan}; both reads run, and fail, independently. */
export async function scanLocalExercises(langs: Langs): Promise<LocalExerciseScan> {
  const [localExercises, settings] = await Promise.all([
    langs.listLocalExercises(),
    langs.listSettings(),
  ])
  return { localExercises, settings }
}

/**
 * Passes the local exercises of every stored course to WorkspaceManager.
 *
 * @param scan A scan read since the last change on disk or to the settings; read afresh
 * when omitted.
 */
export async function refreshLocalExercises(
  actionContext: ReadyActionContext,
  scan?: LocalExerciseScan,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Refreshing local exercises")

  const { localExercises: localExercisesResult, settings: settingsResult } =
    scan ?? (await scanLocalExercises(langs))
  if (localExercisesResult.err) {
    return localExercisesResult
  }
  if (settingsResult.err) {
    Logger.warn(
      "Failed to determine closed status for exercises, keeping the statuses already shown.",
      settingsResult.val,
    )
  }
  const settings = settingsResult.ok ? settingsResult.val : {}

  // TMC by slug, as its projects config records no course id; mooc by id, since a mooc
  // course's on-disk slug is derived locally and need not match its name.
  const localExercisesByCourse = new Map<string, LocalExercise[]>()
  for (const exercise of localExercisesResult.val) {
    const key =
      exercise.backend === "tmc"
        ? `tmc:${exercise["course-slug"]}`
        : `mooc:${exercise["course-id"]}`
    const exercises = localExercisesByCourse.get(key)
    if (exercises) {
      exercises.push(exercise)
    } else {
      localExercisesByCourse.set(key, [exercise])
    }
  }

  const workspaceExercises: WorkspaceExercise[] = []
  for (const course of userData.getCourses()) {
    const courseSlug = LocalCourseData.getCourseName(course)
    const localExercises = localExercisesByCourse.get(
      match(
        course,
        () => `tmc:${courseSlug}`,
        (mooc) => `mooc:${mooc.id}`,
      ),
    )
    if (!localExercises) {
      continue
    }

    const closedExercises = new Set(
      readClosedExercises(settings, closedExercisesSettingKey(course.kind, courseSlug)),
    )

    const courseId = LocalCourseData.getCourseId(course)
    workspaceExercises.push(
      ...localExercises.map<WorkspaceExercise>((x) => {
        const id: ExerciseIdentifier =
          x.backend === "tmc"
            ? makeTmcKind({ tmcExerciseId: x["exercise-id"] })
            : makeMoocKind({ moocExerciseId: x["exercise-id"] })
        const isClosed = settingsResult.ok
          ? closedExercises.has(x["exercise-slug"])
          : workspaceManager.getExercise(id)?.status === ExerciseStatus.Closed
        return {
          id,
          courseId,
          backend: x.backend,
          courseSlug,
          exerciseSlug: x["exercise-slug"],
          status: isClosed ? ExerciseStatus.Closed : ExerciseStatus.Open,
          uri: vscode.Uri.file(x["exercise-path"]),
        }
      }),
    )
  }

  return workspaceManager.setExercises(workspaceExercises, settingsResult.ok)
}
