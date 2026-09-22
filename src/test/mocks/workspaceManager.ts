import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import type WorkspaceManager from "../../api/workspaceManager"
import type { BackendKind } from "../../shared/shared"
import { workspaceExercises } from "../fixtures/workspaceManager"

const NOT_MOCKED_ERROR = Err(new Error("Method was not mocked."))

export interface WorkspaceManagerMockValues {
  activeCourse?: string | undefined
  activeCourseBackend?: BackendKind | undefined
  activeExercise?: Readonly<WorkspaceExercise> | undefined
  closeExercises: Result<WorkspaceExercise[], Error>
  getExerciseByPath: Readonly<WorkspaceExercise> | undefined
  getExercisesByCoursePythonCourse: readonly WorkspaceExercise[]
  setExercises: Result<void, Error>
}

export function createWorkspaceMangerMock(): [WorkspaceManager, WorkspaceManagerMockValues] {
  const values: WorkspaceManagerMockValues = {
    activeCourse: undefined,
    activeCourseBackend: undefined,
    activeExercise: undefined,
    closeExercises: Ok(workspaceExercises),
    getExerciseByPath: undefined,
    getExercisesByCoursePythonCourse: workspaceExercises,
    setExercises: Ok.EMPTY,
  }

  const mock = {
    get activeCourse() {
      return values.activeCourse
    },
    get activeCourseBackend() {
      return values.activeCourseBackend
    },
    get activeExercise() {
      return values.activeExercise
    },
    closeCourseExercises: vi.fn(async (backend: string, courseSlug: string) =>
      backend === "tmc" && courseSlug === "test-python-course"
        ? values.closeExercises
        : NOT_MOCKED_ERROR,
    ),
    getExerciseByPath: vi.fn((uri: vscode.Uri) =>
      values.getExerciseByPath?.uri.fsPath === uri.fsPath ? values.getExerciseByPath : undefined,
    ),
    // Unlike production, there is one fixture exercise, not a path map: containment is
    // its own uri or any path below it.
    getExerciseContaining: vi.fn((uri: vscode.Uri) => {
      const exercise = values.getExerciseByPath
      if (!exercise) {
        return undefined
      }
      const exercisePath = exercise.uri.fsPath
      return uri.fsPath === exercisePath || uri.fsPath.startsWith(exercisePath + path.sep)
        ? exercise
        : undefined
    }),
    getExercisesByCourseSlug: vi.fn((backend: string, courseSlug: string) =>
      backend === "tmc" && courseSlug === "test-python-course"
        ? values.getExercisesByCoursePythonCourse
        : [],
    ),
    setExercises: vi.fn(async () => values.setExercises),
  }

  return [mock as unknown as WorkspaceManager, values]
}
