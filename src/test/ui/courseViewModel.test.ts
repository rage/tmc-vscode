import * as vscode from "vscode"

import type {
  LocalCourseData,
  SharedMoocCourseExercise,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
} from "../../../shared/lib"
import { ExerciseIdentifier, makeTmcKind } from "../../../shared/lib"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { CourseViewState, PartView } from "../../ui/treeview/courseViewModel"
import {
  buildCourseView,
  exercisesToDownload,
  nextExerciseAfter,
  onDiskByCourse,
} from "../../ui/treeview/courseViewModel"
import {
  MOOC_COURSE_ID,
  moocCourseExercise,
  moocLocalCourse,
  tmcCourseExercise,
  tmcLocalCourse,
} from "../fixtures/courses"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"

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

/** Exercise `id` of the tmc course {@link course} builds, on disk. */
function onDisk(
  id: number,
  exerciseSlug: string,
  status: ExerciseStatus,
  overrides: Partial<WorkspaceExercise> = {},
): WorkspaceExercise {
  return {
    id: idOfTmcExercise(id),
    courseId: idOfTmcCourse(42),
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
    isRemoved: () => false,
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
    const open = onDisk(1, "part01-01_hello", ExerciseStatus.Open)
    const parts = build(
      course([
        exercise({ id: 1, name: "part01-01_hello" }),
        exercise({ id: 2, name: "part01-02_world" }),
      ]),
      [open, onDisk(2, "part01-02_world", ExerciseStatus.Closed)],
    )

    expect(statuses(parts)).toEqual(["opened", "closed"])
    expect(parts[0]?.exercises[0]?.onDisk).toBe(open)
  })

  test("ignores an identically named exercise belonging to another course or backend", () => {
    // The workspace tracks every downloaded exercise, so the course a status belongs to
    // has to be checked or two courses sharing a slug would read each other's state.
    const parts = build(course([exercise({ id: 1, name: "part01-01_hello" })]), [
      onDisk(1, "part01-01_hello", ExerciseStatus.Open, { courseId: idOfTmcCourse(7) }),
      onDisk(1, "part01-01_hello", ExerciseStatus.Open, {
        id: idOfMoocExercise("1"),
        courseId: idOfMoocCourse("42"),
        backend: "mooc",
      }),
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
      [onDisk(3, "part01-03_c", ExerciseStatus.Closed)],
      {
        downloadStatusOf: (id) =>
          ExerciseIdentifier.toString(id) === "1" ? "downloading" : "downloadFailed",
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

  test("lists a removed exercise apart, after the course's parts, never as an update", () => {
    const parts = build(
      course([exercise({ id: 1, name: "part01-01_a" }), exercise({ id: 2, name: "part01-02_b" })]),
      [onDisk(2, "part01-02_b", ExerciseStatus.Open)],
      {
        updateable: [idOfTmcExercise(2)],
        isRemoved: (id) => ExerciseIdentifier.toString(id) === "2",
      },
    )

    expect(parts.map((part) => part.name)).toEqual(["part01", "Removed from the course"])
    expect(parts[1]?.exercises.map((ex) => [ex.slug, ex.status, ex.isUpdateable])).toEqual([
      ["part01-02_b", "removed", false],
    ])
  })

  test("lists an exercise on disk that the course no longer has as removed", () => {
    const parts = build(course([exercise({ id: 1, name: "part01-01_a" })]), [
      onDisk(9, "part01-09_gone", ExerciseStatus.Closed),
    ])

    expect(parts.at(-1)?.exercises.map((ex) => [ex.name, ex.status, ex.passed])).toEqual([
      ["part01-09_gone", "removed", false],
    ])
  })

  test("lists an exercise on disk whose chapter has not opened under that chapter, unsubmittable", () => {
    const courseData = moocLocalCourse({
      exercises: [moocExercise("a", "open_one")],
      closedChapters: [
        {
          name: "Recursion",
          number: 3,
          opensAt: "2100-01-01T00:00:00Z",
          exercises: [moocExercise("b", "on_disk"), moocExercise("c", "not_downloaded")],
        },
      ],
    })
    const parts = build(courseData, [
      onDisk(0, "on_disk", ExerciseStatus.Closed, {
        id: idOfMoocExercise("b"),
        courseId: idOfMoocCourse(MOOC_COURSE_ID),
        backend: "mooc",
      }),
    ])

    const closed = parts.find((part) => part.name === "Recursion")
    expect(closed?.opensAt).toEqual(new Date("2100-01-01T00:00:00Z"))
    expect(closed?.exercises.map((ex) => [ex.name, ex.status, ex.submitRefusal])).toEqual([
      ["on_disk", "closed", "chapterNotOpenYet"],
    ])
    // The unchaptered exercises come after every chapter.
    expect(parts.flatMap((part) => part.exercises.map((ex) => ex.name))).toEqual([
      "on_disk",
      "open_one",
    ])
  })

  test("refuses submissions on a course the student is no longer enrolled on", () => {
    const parts = build(
      moocLocalCourse({ exercises: [moocExercise("a", "loops")], notEnrolled: true }),
    )

    expect(parts.flatMap((part) => part.exercises.map((ex) => ex.submitRefusal))).toEqual([
      "notEnrolled",
    ])
  })

  test("says why the backend would refuse a submission, and carries the tries left", () => {
    const parts = build(
      moocCourse([
        moocExercise("a", "late", { deadline: "2026-05-01T00:00:00Z" }),
        moocExercise("b", "last_try", { maxTries: 3, triesLeft: 1 }),
        moocExercise("c", "locked", {
          chapter: { name: "Loops", number: 2, lockingStatus: "NotUnlockedYet" },
        }),
      ]),
    )
    const views = parts.flatMap((part) => part.exercises)

    expect(views.map((ex) => [ex.name, ex.submitRefusal, ex.triesLeft])).toEqual([
      ["locked", "chapterNotUnlockedYet", undefined],
      ["late", "deadlinePassed", undefined],
      ["last_try", undefined, 1],
    ])
    expect(parts.find((part) => part.name === "Loops")?.lockingStatus).toBe("NotUnlockedYet")
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

  test("groups mooc exercises by chapter in chapter order, the unchaptered ones last", () => {
    const basics = { name: "Basics", number: 1 }
    const loops = { name: "Loops", number: 2 }
    const parts = build(
      moocCourse([
        moocExercise("cccccccc-cccc-4ccc-accc-000000000001", "Extra", {}),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000002", "While", { chapter: loops }),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000003", "Print", { chapter: basics }),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000004", "For", { chapter: loops }),
      ]),
    )

    expect(parts.map((part) => [part.name, part.isUngrouped])).toEqual([
      ["Basics", false],
      ["Loops", false],
      ["MOOC Python", true],
    ])
    expect(parts[1]?.exercises.map((ex) => ex.name)).toEqual(["While", "For"])
  })

  test("keeps two chapters that share a name apart, and one named like the course grouped", () => {
    const parts = build(
      moocCourse([
        moocExercise("cccccccc-cccc-4ccc-accc-000000000001", "Recap 1", {
          chapter: { name: "Recap", number: 1 },
        }),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000002", "Recap 2", {
          chapter: { name: "Recap", number: 2 },
        }),
        moocExercise("cccccccc-cccc-4ccc-accc-000000000003", "Intro", {
          chapter: { name: "MOOC Python", number: 3 },
        }),
      ]),
    )

    expect(parts.map((part) => [part.name, part.isUngrouped, part.exercises.length])).toEqual([
      ["Recap", false, 1],
      ["Recap", false, 1],
      ["MOOC Python", false, 1],
    ])
    expect(new Set(parts.map((part) => part.key)).size).toBe(3)
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

suite("nextExerciseAfter", () => {
  test("is the next exercise in view order that is still to do", () => {
    const courseData = course([
      exercise({ id: 3, name: "part02-01_loops" }),
      exercise({ id: 1, name: "part01-01_hello" }),
      exercise({ id: 2, name: "part01-02_world", passed: true }),
    ])

    expect(nextExerciseAfter(courseData, idOfTmcExercise(1), NOW)).toEqual(idOfTmcExercise(3))
  })

  test("skips the expired, then wraps around to an earlier one left to do", () => {
    const courseData = course([
      exercise({ id: 1, name: "part01-01_hello" }),
      exercise({ id: 2, name: "part01-02_world", passed: true }),
      exercise({ id: 3, name: "part01-03_late", deadline: "2026-05-01T00:00:00Z" }),
    ])

    expect(nextExerciseAfter(courseData, idOfTmcExercise(2), NOW)).toEqual(idOfTmcExercise(1))
  })

  test("skips a mooc exercise with no tries left", () => {
    const courseData = moocCourse([
      moocExercise("a", "first", { passed: true }),
      moocExercise("b", "second", { outOfTries: true }),
      moocExercise("c", "third"),
    ])

    expect(nextExerciseAfter(courseData, idOfMoocExercise("a"), NOW)).toEqual(idOfMoocExercise("c"))
  })

  test("skips an exercise whose chapter locking refuses submissions", () => {
    const courseData = moocCourse([
      moocExercise("a", "first", { passed: true }),
      moocExercise("b", "second", {
        chapter: { name: "Later", number: 2, lockingStatus: "NotUnlockedYet" },
      }),
      moocExercise("c", "third"),
    ])

    expect(nextExerciseAfter(courseData, idOfMoocExercise("a"), NOW)).toEqual(idOfMoocExercise("c"))
  })

  test("is nothing when every other exercise is done", () => {
    const courseData = course([
      exercise({ id: 1, name: "part01-01_hello" }),
      exercise({ id: 2, name: "part01-02_world", passed: true }),
    ])

    expect(nextExerciseAfter(courseData, idOfTmcExercise(1), NOW)).toBeUndefined()
  })
})

suite("exercisesToDownload", () => {
  const fiveParts = course(
    [1, 2, 3, 4, 5].map((n) =>
      exercise({
        id: n,
        name: `part0${n}-01_ex`,
        deadline: n === 2 ? "2026-06-08T00:00:00Z" : n === 1 ? "2026-05-01T00:00:00Z" : null,
      }),
    ),
  )

  test("is every exercise not on disk that is not past its deadline", () => {
    const onDiskNow = [onDisk(3, "part03-01_ex", ExerciseStatus.Closed)]

    expect(exercisesToDownload(fiveParts, onDiskNow, NOW, "all")).toEqual([
      idOfTmcExercise(2),
      idOfTmcExercise(4),
      idOfTmcExercise(5),
    ])
  })

  test("in a long course, the starting parts are the one due next", () => {
    expect(exercisesToDownload(fiveParts, [], NOW, "startingParts")).toEqual([idOfTmcExercise(2)])
  })

  test("in a short course, the starting parts are all of them", () => {
    const short = course([
      exercise({ id: 1, name: "part01-01_ex" }),
      exercise({ id: 2, name: "part02-01_ex" }),
    ])

    expect(exercisesToDownload(short, [], NOW, "startingParts")).toEqual([
      idOfTmcExercise(1),
      idOfTmcExercise(2),
    ])
  })
})
