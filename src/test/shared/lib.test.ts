import type { LocalCourseData, LocalCourseExercise } from "../../shared/shared"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData as LCD,
  LocalCourseExercise as LCE,
  makeMoocKind,
  makeTmcKind,
  match,
  matchBackend,
  matchOption,
} from "../../shared/shared"

suite("CourseIdentifier", function () {
  test("from(number) builds a tmc identifier, from(string) a mooc one", function () {
    expect(CourseIdentifier.from(42)).toEqual({ kind: "tmc", data: { courseId: 42 } })
    expect(CourseIdentifier.from("uuid")).toEqual({ kind: "mooc", data: { instanceId: "uuid" } })
  })

  test("toString round-trips through from for both backends", function () {
    expect(CourseIdentifier.toString(CourseIdentifier.from(42))).toBe("42")
    expect(CourseIdentifier.toString(CourseIdentifier.from("course-uuid"))).toBe("course-uuid")
  })
})

suite("ExerciseIdentifier", function () {
  test("from(number) builds a tmc identifier, from(string) a mooc one", function () {
    expect(ExerciseIdentifier.from(7)).toEqual({ kind: "tmc", data: { tmcExerciseId: 7 } })
    expect(ExerciseIdentifier.from("ex-uuid")).toEqual({
      kind: "mooc",
      data: { moocExerciseId: "ex-uuid" },
    })
  })

  test("toString and unwrap recover the original id", function () {
    expect(ExerciseIdentifier.toString(ExerciseIdentifier.from(7))).toBe("7")
    expect(ExerciseIdentifier.toString(ExerciseIdentifier.from("ex-uuid"))).toBe("ex-uuid")
    expect(ExerciseIdentifier.unwrap(ExerciseIdentifier.from(7))).toBe(7)
    expect(ExerciseIdentifier.unwrap(ExerciseIdentifier.from("ex-uuid"))).toBe("ex-uuid")
  })

  test("template-stringing the identifier object is the wrong way to key it", function () {
    // Guard against the recurring bug class: an ExerciseIdentifier is a tagged
    // union object, so `${id}` collapses to "[object Object]" and every id
    // looks identical. toString is the only correct way to derive a key.
    const id = ExerciseIdentifier.from(5)
    expect(`${id}`).toBe("[object Object]")
    expect(ExerciseIdentifier.toString(id)).toBe("5")
    expect(ExerciseIdentifier.toString(ExerciseIdentifier.from(6))).not.toBe(
      ExerciseIdentifier.toString(id),
    )
  })
})

suite("match helpers", function () {
  test("match dispatches on the tagged-union kind", function () {
    expect(
      match(
        makeTmcKind({ a: 1 }),
        (x) => `tmc:${x.a}`,
        (x: { b: string }) => `mooc:${x.b}`,
      ),
    ).toBe("tmc:1")
    expect(
      match(
        makeMoocKind({ b: "x" }),
        (x: { a: number }) => `tmc:${x.a}`,
        (x) => `mooc:${x.b}`,
      ),
    ).toBe("mooc:x")
  })

  test("matchOption returns undefined for an undefined value", function () {
    const result = matchOption(
      undefined,
      () => "tmc",
      () => "mooc",
    )
    expect(result).toBeUndefined()
  })

  test("matchBackend dispatches on a backend-tagged object", function () {
    expect(
      matchBackend(
        { backend: "tmc" as const },
        () => "t",
        () => "m",
      ),
    ).toBe("t")
    expect(
      matchBackend(
        { backend: "mooc" as const },
        () => "t",
        () => "m",
      ),
    ).toBe("m")
  })
})

suite("LocalCourseExercise / LocalCourseData namespaces", function () {
  const tmcExercise: LocalCourseExercise = makeTmcKind({
    id: 3,
    availablePoints: 1,
    awardedPoints: 0,
    name: "ex3",
    deadline: null,
    passed: false,
    softDeadline: null,
  })
  const moocExercise: LocalCourseExercise = makeMoocKind({
    id: "ex-uuid",
    availablePoints: 1,
    awardedPoints: 0,
    name: "mooc-ex",
    deadline: null,
    passed: false,
    softDeadline: null,
  })

  test("LocalCourseExercise.getId builds a matching ExerciseIdentifier", function () {
    expect(LCE.getId(tmcExercise)).toEqual(ExerciseIdentifier.from(3))
    expect(LCE.getId(moocExercise)).toEqual(ExerciseIdentifier.from("ex-uuid"))
    expect(LCE.getSlug(tmcExercise)).toBe("ex3")
    expect(LCE.getSlug(moocExercise)).toBe("mooc-ex")
  })

  test("LocalCourseData.getCourseId uses course id for tmc, courseId for mooc", function () {
    const tmcCourse = makeTmcKind({ id: 9 }) as unknown as LocalCourseData
    const moocCourse = makeMoocKind({
      courseId: "c-uuid",
      id: "i-uuid",
    }) as unknown as LocalCourseData
    expect(LCD.getCourseId(tmcCourse)).toEqual(CourseIdentifier.from(9))
    // mooc getCourseId keys on courseId, not the instance id
    expect(LCD.getCourseId(moocCourse)).toEqual(CourseIdentifier.from("c-uuid"))
  })

  test("LocalCourseData.getNewExercises maps ids to identifiers", function () {
    const tmcCourse = makeTmcKind({ newExercises: [1, 2] }) as unknown as LocalCourseData
    const moocCourse = makeMoocKind({ newExercises: ["a", "b"] }) as unknown as LocalCourseData
    expect(LCD.getNewExercises(tmcCourse)).toEqual([
      ExerciseIdentifier.from(1),
      ExerciseIdentifier.from(2),
    ])
    expect(LCD.getNewExercises(moocCourse)).toEqual([
      ExerciseIdentifier.from("a"),
      ExerciseIdentifier.from("b"),
    ])
  })
})
