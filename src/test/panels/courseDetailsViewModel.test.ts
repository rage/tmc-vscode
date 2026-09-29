import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { buildCourseDetailsView } from "../../panels/courseDetailsViewModel"
import type {
  LocalCourseData,
  SharedMoocCourseExercise,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
} from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"

const COURSE_NAME = "python-course"
const formatInFinnish = (iso: string): string =>
  new Intl.DateTimeFormat("fi", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
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

function course(
  exercises: SharedTmcCourseExercise[],
  overrides: Partial<SharedTmcCourseData> = {},
): LocalCourseData {
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
    ...overrides,
  })
}

function moocExercise(
  id: string,
  name: string,
  overrides: Partial<SharedMoocCourseExercise> = {},
): SharedMoocCourseExercise {
  return {
    id,
    availablePoints: 1,
    awardedPoints: 0,
    name,
    deadline: null,
    passed: false,
    softDeadline: null,
    ...overrides,
  }
}

function moocCourse(exercises: SharedMoocCourseExercise[]): LocalCourseData {
  return makeMoocKind({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "mooc-python",
    title: "MOOC Python",
    description: null,
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

    expect(view.exerciseStatuses[0]?.status).toBe("missing")
  })

  test("calls an undownloaded exercise new only when the course published it as new", () => {
    const view = buildCourseDetailsView(
      course(
        [
          exercise({ id: 1, name: "part01-01_hello" }),
          exercise({ id: 2, name: "part01-02_world" }),
        ],
        { newExercises: [2] },
      ),
      [],
      false,
      NOW,
    )

    expect(view.exerciseStatuses.map((entry) => entry.status)).toEqual(["missing", "new"])
  })

  test("sorts part and exercise numbers numerically", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 1, name: "part10-01_last" }),
        exercise({ id: 2, name: "part2-10_ten" }),
        exercise({ id: 3, name: "part2-9_nine" }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.name)).toEqual(["part2", "part10"])
    expect(view.exerciseGroups[0]?.exercises.map((ex) => ex.name)).toEqual(["9_nine", "10_ten"])
  })

  test("names a tmc exercise without a part prefix by its whole slug", () => {
    const view = buildCourseDetailsView(course([exercise({ name: "Tehtävä-1" })]), [], false, NOW)

    expect(view.exerciseGroups.map((group) => group.name)).toEqual(["Python Course"])
    expect(view.exerciseGroups[0]?.exercises[0]?.name).toBe("Tehtävä-1")
  })

  test("lists mooc exercises by their full name, in course order, under the course title", () => {
    const view = buildCourseDetailsView(
      moocCourse([
        moocExercise("cccccccc-cccc-4ccc-accc-000000000001", "python3_simple"),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000002", "Hello world"),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000003", "part01-01_hello"),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.name)).toEqual(["MOOC Python"])
    expect(view.exerciseGroups[0]?.exercises.map((ex) => ex.name)).toEqual([
      "python3_simple",
      "Hello world",
      "part01-01_hello",
    ])
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

    expect(view.exerciseStatuses.map((entry) => entry.status)).toEqual(["expired", "missing"])
  })

  test("carries each exercise's own passed flag", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 1, name: "part01-01_hello", passed: true }),
        exercise({ id: 2, name: "part01-02_world", passed: false }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups[0]?.exercises.map((ex) => ex.passed)).toEqual([true, false])
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

  test("renders deadlines in the display language and exposes the shown one as ISO", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 1, name: "part01-01_hello", deadline: "2026-09-01T12:00:00Z" }),
        exercise({
          id: 2,
          name: "part01-02_world",
          softDeadline: "2026-08-01T12:00:00Z",
          deadline: "2026-09-01T12:00:00Z",
        }),
      ]),
      [],
      false,
      NOW,
      "fi",
    )

    const [hard, soft] = view.exerciseGroups[0]?.exercises ?? []
    expect(hard?.hardDeadlineString).toBe(formatInFinnish("2026-09-01T12:00:00Z"))
    expect(hard?.deadlineIso).toBe("2026-09-01T12:00:00.000Z")
    expect(soft?.softDeadlineString).toBe(formatInFinnish("2026-08-01T12:00:00Z"))
    expect(soft?.deadlineIso).toBe("2026-08-01T12:00:00.000Z")
    expect(view.exerciseGroups[0]?.nextDeadlineString).toBe(
      `Next deadline: ${formatInFinnish("2026-08-01T12:00:00Z")}`,
    )
  })

  test("sends only what the panel renders, with no Date objects", () => {
    const view = buildCourseDetailsView(
      course([exercise({ name: "part01-01_hello", deadline: "2026-07-01T00:00:00Z" })]),
      [],
      false,
      NOW,
      "en",
    )

    expect(Object.keys(view.exerciseGroups[0]?.exercises[0] ?? {}).toSorted()).toEqual([
      "deadlineIso",
      "hardDeadlineString",
      "id",
      "isHard",
      "name",
      "passed",
      "softDeadlineString",
    ])
  })

  test("opens every part of a course with three or fewer", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 1, name: "part01-01_a" }),
        exercise({ id: 2, name: "part02-01_b" }),
        exercise({ id: 3, name: "part03-01_c" }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.defaultOpen)).toEqual([true, true, true])
  })

  test("opens only the part with the soonest unmet deadline in a longer course", () => {
    const view = buildCourseDetailsView(
      course([
        exercise({ id: 1, name: "part01-01_a", deadline: "2026-05-01T00:00:00Z" }),
        exercise({ id: 2, name: "part02-01_b", deadline: "2026-06-10T00:00:00Z", passed: true }),
        exercise({ id: 3, name: "part03-01_c", deadline: "2026-06-20T00:00:00Z" }),
        exercise({ id: 4, name: "part04-01_d", deadline: "2026-07-01T00:00:00Z" }),
      ]),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.defaultOpen)).toEqual([
      false,
      false,
      true,
      false,
    ])
  })

  test("opens the first part of a longer course that has no upcoming deadline", () => {
    const view = buildCourseDetailsView(
      course([1, 2, 3, 4].map((n) => exercise({ id: n, name: `part0${n}-01_x` }))),
      [],
      false,
      NOW,
    )

    expect(view.exerciseGroups.map((group) => group.defaultOpen)).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})
