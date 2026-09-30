import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type {
  LocalCourseData,
  SharedMoocCourseExercise,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
} from "../../shared/shared"
import { ExerciseIdentifier, makeTmcKind } from "../../shared/shared"
import type { CourseViewState, PartView } from "../../ui/treeview/courseViewModel"
import { buildCourseView, onDiskByCourse } from "../../ui/treeview/courseViewModel"
import {
  moocCourseExercise,
  moocLocalCourse,
  tmcCourseExercise,
  tmcLocalCourse,
} from "../fixtures/courses"

const COURSE_NAME = "python-course"
const NOW = new Date("2026-06-01T12:00:00Z")

const exercise = tmcCourseExercise

function course(
  exercises: SharedTmcCourseExercise[],
  overrides: Partial<SharedTmcCourseData> = {},
): LocalCourseData {
  return tmcLocalCourse({ name: COURSE_NAME, exercises, ...overrides })
}

function moocExercise(
  id: string,
  name: string,
  overrides: Partial<SharedMoocCourseExercise> = {},
): SharedMoocCourseExercise {
  return moocCourseExercise({ id, name, ...overrides })
}

function moocCourse(exercises: SharedMoocCourseExercise[]): LocalCourseData {
  return moocLocalCourse({ exercises })
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

function build(
  courseData: LocalCourseData,
  workspaceExercises: WorkspaceExercise[] = [],
  state: Partial<CourseViewState> = {},
): PartView[] {
  return buildCourseView(courseData, {
    onDisk: onDiskByCourse(workspaceExercises)(courseData),
    downloadStatusOf: () => undefined,
    updateable: [],
    now: NOW,
    ...state,
  })
}

function statuses(parts: PartView[]): string[] {
  return parts.flatMap((part) => part.exercises.map((ex) => ex.status))
}

suite("buildCourseView", () => {
  test("groups exercises by their slug prefix, sorting both parts and their exercises", () => {
    const parts = build(
      course([
        exercise({ id: 3, name: "part02-01_loops" }),
        exercise({ id: 2, name: "part01-02_world" }),
        exercise({ id: 1, name: "part01-01_hello" }),
      ]),
    )

    expect(parts.map((part) => [part.name, part.isUngrouped])).toEqual([
      ["part01", false],
      ["part02", false],
    ])
    expect(parts[0]?.exercises.map((ex) => ex.name)).toEqual(["01_hello", "02_world"])
    expect(parts[0]?.exercises.map((ex) => ex.slug)).toEqual(["part01-01_hello", "part01-02_world"])
  })

  test("reports the on-disk status of a downloaded exercise, with the exercise on disk", () => {
    const open = onDisk("part01-01_hello", ExerciseStatus.Open)
    const parts = build(
      course([exercise({ name: "part01-01_hello" }), exercise({ id: 2, name: "part01-02_world" })]),
      [open, onDisk("part01-02_world", ExerciseStatus.Closed)],
    )

    expect(statuses(parts)).toEqual(["opened", "closed"])
    expect(parts[0]?.exercises[0]?.onDisk).toBe(open)
  })

  test("ignores an identically named exercise belonging to another course or backend", () => {
    // The workspace tracks every downloaded exercise, so the course a status belongs to
    // has to be checked or two courses sharing a slug would read each other's state.
    const parts = build(course([exercise({ name: "part01-01_hello" })]), [
      onDisk("part01-01_hello", ExerciseStatus.Open, { courseSlug: "java-course" }),
      onDisk("part01-01_hello", ExerciseStatus.Open, { backend: "mooc" }),
    ])

    expect(statuses(parts)).toEqual(["missing"])
  })

  test("calls an undownloaded exercise new only when the course published it as new", () => {
    const parts = build(
      course(
        [
          exercise({ id: 1, name: "part01-01_hello" }),
          exercise({ id: 2, name: "part01-02_world" }),
        ],
        { newExercises: [2] },
      ),
    )

    expect(statuses(parts)).toEqual(["missing", "new"])
  })

  test("shows a running download over the disk, and a failed one only while not on disk", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_a" }),
        exercise({ id: 2, name: "part01-02_b" }),
        exercise({ id: 3, name: "part01-03_c" }),
      ]),
      [onDisk("part01-03_c", ExerciseStatus.Closed)],
      {
        downloadStatusOf: (id) =>
          ExerciseIdentifier.unwrap(id) === 1 ? "downloading" : "downloadFailed",
      },
    )

    expect(statuses(parts)).toEqual(["downloading", "downloadFailed", "closed"])
  })

  test("marks the exercises the last update check found", () => {
    const parts = build(
      course([exercise({ id: 1, name: "part01-01_a" }), exercise({ id: 2, name: "part01-02_b" })]),
      [],
      { updateable: [makeTmcKind({ tmcExerciseId: 2 })] },
    )

    expect(parts[0]?.exercises.map((ex) => ex.isUpdateable)).toEqual([false, true])
  })

  test("sorts part and exercise numbers numerically", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part10-01_last" }),
        exercise({ id: 2, name: "part2-10_ten" }),
        exercise({ id: 3, name: "part2-9_nine" }),
      ]),
    )

    expect(parts.map((part) => part.name)).toEqual(["part2", "part10"])
    expect(parts[0]?.exercises.map((ex) => ex.name)).toEqual(["9_nine", "10_ten"])
  })

  test("names a tmc exercise without a part prefix by its whole slug", () => {
    const parts = build(course([exercise({ name: "Tehtävä-1" })]))

    expect(parts.map((part) => [part.name, part.isUngrouped])).toEqual([["Python Course", true]])
    expect(parts[0]?.exercises[0]?.name).toBe("Tehtävä-1")
  })

  test("lists mooc exercises by their full name, in course order, under the course title", () => {
    const parts = build(
      moocCourse([
        moocExercise("cccccccc-cccc-4ccc-accc-000000000001", "python3_simple"),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000002", "Hello world"),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000003", "part01-01_hello"),
      ]),
    )

    expect(parts.map((part) => [part.name, part.isUngrouped])).toEqual([["MOOC Python", true]])
    expect(parts[0]?.exercises.map((ex) => ex.name)).toEqual([
      "python3_simple",
      "Hello world",
      "part01-01_hello",
    ])
  })

  test("marks an undownloaded exercise past its hard deadline as expired", () => {
    const parts = build(
      course([
        exercise({ name: "part01-01_hello", deadline: "2026-05-01T00:00:00Z" }),
        exercise({ id: 2, name: "part01-02_world", deadline: "2026-07-01T00:00:00Z" }),
      ]),
    )

    expect(statuses(parts)).toEqual(["expired", "missing"])
  })

  test("carries each exercise's own passed flag and points", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_hello", passed: true, awardedPoints: 1 }),
        exercise({ id: 2, name: "part01-02_world", passed: false }),
      ]),
    )

    expect(parts[0]?.exercises.map((ex) => [ex.passed, ex.awardedPoints])).toEqual([
      [true, 1],
      [false, 0],
    ])
  })

  test("a soft deadline binds only when it comes before the hard one", () => {
    const parts = build(
      course([
        exercise({
          id: 1,
          name: "part01-01_soft",
          softDeadline: "2026-06-10T00:00:00Z",
          deadline: "2026-06-20T00:00:00Z",
        }),
        exercise({
          id: 2,
          name: "part01-02_hard",
          softDeadline: "2026-06-30T00:00:00Z",
          deadline: "2026-06-20T00:00:00Z",
        }),
      ]),
    )

    expect(parts[0]?.exercises.map((ex) => ex.isHard)).toEqual([false, true])
  })

  test("a part's next deadline is the soonest unmet one of an exercise not yet passed", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_a", deadline: "2026-06-05T00:00:00Z", passed: true }),
        exercise({ id: 2, name: "part01-02_b", deadline: "2026-05-01T00:00:00Z" }),
        exercise({ id: 3, name: "part01-03_c", deadline: "2026-06-10T00:00:00Z" }),
      ]),
    )

    expect(parts[0]?.nextDeadline?.toISOString()).toBe("2026-06-10T00:00:00.000Z")
  })

  test("opens every part of a course with three or fewer", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_a" }),
        exercise({ id: 2, name: "part02-01_b" }),
        exercise({ id: 3, name: "part03-01_c" }),
      ]),
    )

    expect(parts.map((part) => part.isDefaultOpen)).toEqual([true, true, true])
  })

  test("opens only the part with the soonest unmet deadline in a longer course", () => {
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_a", deadline: "2026-05-01T00:00:00Z" }),
        exercise({ id: 2, name: "part02-01_b", deadline: "2026-06-10T00:00:00Z", passed: true }),
        exercise({ id: 3, name: "part03-01_c", deadline: "2026-06-20T00:00:00Z" }),
        exercise({ id: 4, name: "part04-01_d", deadline: "2026-07-01T00:00:00Z" }),
      ]),
    )

    expect(parts.map((part) => part.isDefaultOpen)).toEqual([false, false, true, false])
  })

  test("opens the first part of a longer course that has no upcoming deadline", () => {
    const parts = build(
      course([1, 2, 3, 4].map((n) => exercise({ id: n, name: `part0${n}-01_x` }))),
    )

    expect(parts.map((part) => part.isDefaultOpen)).toEqual([true, false, false, false])
  })
})
