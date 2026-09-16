import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { buildCourseDetailsView } from "../../panels/courseDetailsViewModel"
import type { LocalCourseData, SharedTmcCourseExercise } from "../../shared/shared"
import { makeTmcKind } from "../../shared/shared"

const COURSE_NAME = "python-course"
const NOW = new Date("2026-06-01T12:00:00Z")

function exercise(overrides: Partial<SharedTmcCourseExercise> = {}): SharedTmcCourseExercise {
  return {
    id: 1,
    availablePoints: 1,
    awardedPoints: 0,
    name: "part01-01_hello",
    deadline: null,
    passed: false,
    softDeadline: null,
    ...overrides,
  }
}

function course(exercises: SharedTmcCourseExercise[]): LocalCourseData {
  return makeTmcKind({
    id: 42,
    name: COURSE_NAME,
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises,
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })
}

function onDisk(
  exerciseSlug: string,
  status: ExerciseStatus,
  overrides: Partial<WorkspaceExercise> = {},
): WorkspaceExercise {
  return {
    backend: "tmc",
    courseSlug: COURSE_NAME,
    exerciseSlug,
    status,
    uri: vscode.Uri.file(`/exercises/${exerciseSlug}`),
    ...overrides,
  }
}

suite("buildCourseDetailsView", () => {
  test("groups exercises by their slug prefix, sorting both groups and their exercises", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 3, name: "part02-01_loops" }),
        exercise({ id: 2, name: "part01-02_world" }),
        exercise({ id: 1, name: "part01-01_hello" }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.name)).toEqual(["part01", "part02"])
    expect(view.exerciseGroups[0]?.exercises.map((ex) => ex.name)).toEqual(["01_hello", "02_world"])
  })

  test("reports the on-disk status of a downloaded exercise", () => {
    const view = buildCourseDetailsView(
      course([exercise({ name: "part01-01_hello" }), exercise({ id: 2, name: "part01-02_world" })]),
      [
        onDisk("part01-01_hello", ExerciseStatus.Open),
        onDisk("part01-02_world", ExerciseStatus.Closed),
      ],
      false,
      NOW,
    )

    expect(view.exerciseStatuses.map((entry) => entry.status)).toEqual(["opened", "closed"])
  })

  test("ignores an identically named exercise belonging to another course or backend", () => {
    // The workspace tracks every downloaded exercise, so the course a status belongs to
    // has to be checked or two courses sharing a slug would read each other's state.
    const view = buildCourseDetailsView(
      course([exercise({ name: "part01-01_hello" })]),
      [
        onDisk("part01-01_hello", ExerciseStatus.Open, { courseSlug: "java-course" }),
        onDisk("part01-01_hello", ExerciseStatus.Open, { backend: "mooc" }),
      ],
      false,
      NOW,
    )

    expect(view.exerciseStatuses[0]?.status).toBe("new")
  })

  test("marks an undownloaded exercise past its hard deadline as expired", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ name: "part01-01_hello", deadline: "2026-05-01T00:00:00Z" }),
        exercise({ id: 2, name: "part01-02_world", deadline: "2026-07-01T00:00:00Z" }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseStatuses.map((entry) => entry.status)).toEqual(["expired", "new"])
  })

  test("names the next unmet deadline for a group", () => {
    const view = buildCourseDetailsView(
      course([exercise({ name: "part01-01_hello", deadline: "2026-07-01T00:00:00Z" })]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups[0]?.nextDeadlineString).toMatch(/^Next deadline: /)
  })

  test("withholds deadlines when the backend could not be reached", () => {
    const view = buildCourseDetailsView(
      course([exercise({ name: "part01-01_hello", deadline: "2026-07-01T00:00:00Z" })]),
      [],
      true,
      NOW,
    )

    expect(view.exerciseGroups[0]?.nextDeadlineString).toBe("Next deadline: Not available")
  })
})
