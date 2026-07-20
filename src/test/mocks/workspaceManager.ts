import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import type WorkspaceManager from "../../api/workspaceManager"
import { workspaceExercises } from "../fixtures/workspaceManager"

const NOT_MOCKED_ERROR = Err(new Error("Method was not mocked."))

export interface WorkspaceManagerMockValues {
  activeCourse?: string | undefined
  activeExercise?: Readonly<WorkspaceExercise> | undefined
  closeExercises: Result<WorkspaceExercise[], Error>
  getExerciseByPath: Readonly<WorkspaceExercise> | undefined
  getExercisesByCoursePythonCourse: readonly WorkspaceExercise[]
  setExercises: Result<void, Error>
  uriIsExercise: boolean
}

export function createWorkspaceMangerMock(): [WorkspaceManager, WorkspaceManagerMockValues] {
  const values: WorkspaceManagerMockValues = {
    activeCourse: undefined,
    activeExercise: undefined,
    closeExercises: Ok(workspaceExercises),
    getExerciseByPath: undefined,
    getExercisesByCoursePythonCourse: workspaceExercises,
    setExercises: Ok.EMPTY,
    uriIsExercise: true,
  }

  const mock = {
    get activeCourse() {
      return values.activeCourse
    },
    get activeExercise() {
      return values.activeExercise
    },
    closeCourseExercises: vi.fn(async (backend: string, courseSlug: string) =>
      backend === "tmc" && courseSlug === "test-python-course"
        ? values.closeExercises
        : NOT_MOCKED_ERROR,
    ),
    getExerciseByPath: vi.fn(() => values.getExerciseByPath),
    getExercisesByCourseSlug: vi.fn((courseSlug: string) =>
      courseSlug === "test-python-course" ? values.getExercisesByCoursePythonCourse : [],
    ),
    setExercises: vi.fn(async () => values.setExercises),
    uriIsExercise: vi.fn(() => values.uriIsExercise),
  }

  return [mock as unknown as WorkspaceManager, values]
}
