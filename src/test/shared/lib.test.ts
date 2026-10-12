import { z } from "zod"

import type { LocalCourseData, LocalCourseExercise } from "../../shared/shared"
import {
  CourseIdentifier,
  EnumSchema,
  ExerciseIdentifier,
  LocalCourseData as LCD,
  LocalCourseExercise as LCE,
  makeMoocKind,
  makeTmcKind,
  match,
  partition,
} from "../../shared/shared"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"

suite("EnumSchema", function () {
  test("accepts exactly the tmc and mooc kinds", function () {
    const schema = EnumSchema(z.object({ courseId: z.number() }), z.object({ id: z.string() }))
    const samples = {
      tmc: { kind: "tmc", data: { courseId: 1 } },
      mooc: { kind: "mooc", data: { id: "uuid" } },
    }

    expect(schema.safeParse(samples.tmc).success).toBe(true)
    expect(schema.safeParse(samples.mooc).success).toBe(true)
    expect(schema.safeParse({ kind: "other", data: {} }).success).toBe(false)
  })
})

suite("CourseIdentifier", function () {
  test("toString recovers the original id for both backends", function () {
    expect(CourseIdentifier.toString(idOfTmcCourse(42))).toBe("42")
    expect(CourseIdentifier.toString(idOfMoocCourse("course-uuid"))).toBe("course-uuid")
  })

  test("key and equals tell a tmc and a mooc course with the same id apart", function () {
    const tmc = idOfTmcCourse(1)
    const mooc = idOfMoocCourse("1")

    expect(CourseIdentifier.key(tmc)).not.toBe(CourseIdentifier.key(mooc))
    expect(CourseIdentifier.equals(tmc, mooc)).toBe(false)
    expect(CourseIdentifier.equals(tmc, idOfTmcCourse(1))).toBe(true)
  })
})

suite("ExerciseIdentifier", function () {
  test("toString recovers the original id", function () {
    expect(ExerciseIdentifier.toString(idOfTmcExercise(7))).toBe("7")
    expect(ExerciseIdentifier.toString(idOfMoocExercise("ex-uuid"))).toBe("ex-uuid")
  })

  test("key tells a tmc and a mooc exercise with the same id apart", function () {
    const tmc = idOfTmcExercise(1)
    const mooc = idOfMoocExercise("1")

    expect(ExerciseIdentifier.key(tmc)).not.toBe(ExerciseIdentifier.key(mooc))
    expect(ExerciseIdentifier.key(mooc)).toBe(ExerciseIdentifier.key(idOfMoocExercise("1")))
  })

  test("template-stringing the identifier object is the wrong way to key it", function () {
    // Guard against the recurring bug class: an ExerciseIdentifier is a tagged
    // union object, so `${id}` collapses to "[object Object]" and every id
    // looks identical. toString is the only correct way to derive a key.
    const id = idOfTmcExercise(5)
    expect(`${id}`).toBe("[object Object]")
    expect(ExerciseIdentifier.toString(id)).toBe("5")
    expect(ExerciseIdentifier.toString(idOfTmcExercise(6))).not.toBe(
      ExerciseIdentifier.toString(id),
    )
  })
})

suite("partition", function () {
  test("splits values by backend, keeping their order", function () {
    const ids = [
      idOfMoocExercise("b"),
      idOfTmcExercise(2),
      idOfMoocExercise("a"),
      idOfTmcExercise(1),
    ]

    expect(partition(ids)).toEqual({
      tmc: [{ tmcExerciseId: 2 }, { tmcExerciseId: 1 }],
      mooc: [{ moocExerciseId: "b" }, { moocExerciseId: "a" }],
    })
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
    expect(LCE.getId(tmcExercise)).toEqual(idOfTmcExercise(3))
    expect(LCE.getId(moocExercise)).toEqual(idOfMoocExercise("ex-uuid"))
    expect(LCE.getSlug(tmcExercise)).toBe("ex3")
    expect(LCE.getSlug(moocExercise)).toBe("mooc-ex")
  })

  test("LocalCourseData.getCourseId uses the course id for both backends", function () {
    const tmcCourse = makeTmcKind({ id: 9 }) as unknown as LocalCourseData
    const moocCourse = makeMoocKind({
      id: "course-uuid",
    }) as unknown as LocalCourseData
    expect(LCD.getCourseId(tmcCourse)).toEqual(idOfTmcCourse(9))
    // mooc has no instance concept; getCourseId keys on the sole course id
    expect(LCD.getCourseId(moocCourse)).toEqual(idOfMoocCourse("course-uuid"))
  })

  test("LocalCourseData splits the slug from the title on both backends", function () {
    const tmcCourse = makeTmcKind({
      name: "tmc-slug",
      title: "TMC Course",
    }) as unknown as LocalCourseData
    const moocCourse = makeMoocKind({
      name: "mooc-slug",
      title: "Mooc Course",
    }) as unknown as LocalCourseData
    expect(LCD.getCourseName(tmcCourse)).toBe("tmc-slug")
    expect(LCD.getCourseName(moocCourse)).toBe("mooc-slug")
    expect(LCD.getCourseTitle(tmcCourse)).toBe("TMC Course")
    expect(LCD.getCourseTitle(moocCourse)).toBe("Mooc Course")
  })

  test("LocalCourseData.getNewExercises maps ids to identifiers", function () {
    const tmcCourse = makeTmcKind({ newExercises: [1, 2] }) as unknown as LocalCourseData
    const moocCourse = makeMoocKind({ newExercises: ["a", "b"] }) as unknown as LocalCourseData
    expect(LCD.getNewExercises(tmcCourse)).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
    expect(LCD.getNewExercises(moocCourse)).toEqual([idOfMoocExercise("a"), idOfMoocExercise("b")])
  })
})
