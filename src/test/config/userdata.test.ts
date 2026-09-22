import { vi } from "vitest"

import { UserData } from "../../config/userdata"
import { CorruptStoredDataError } from "../../errors"
import type { LocalCourseExercise } from "../../shared/shared"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
} from "../../shared/shared"
import Storage from "../../storage"
import type * as storage from "../../storage/data"
import { USER_DATA_KEY } from "../../storage/data"
import { createMockContext } from "../mocks/vscode"

// -------------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------------

function tmcExercise(
  overrides: Partial<storage.TmcLocalCourseExercise> = {},
): storage.TmcLocalCourseExercise {
  return {
    id: 1,
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    name: "hello_world",
    passed: false,
    softDeadline: null,
    ...overrides,
  }
}

function moocExercise(
  overrides: Partial<storage.MoocLocalCourseExercise> = {},
): storage.MoocLocalCourseExercise {
  return {
    id: "exercise-uuid-1",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    name: "mooc_hello",
    passed: false,
    softDeadline: null,
    ...overrides,
  }
}

function tmcCourse(
  overrides: Partial<storage.TmcLocalCourseData> = {},
): storage.TmcLocalCourseData {
  return {
    id: 0,
    availablePoints: 2,
    awardedPoints: 0,
    description: "Python Course",
    disabled: false,
    exercises: [
      tmcExercise({ id: 1, name: "hello_world" }),
      tmcExercise({ id: 2, name: "other_world" }),
    ],
    materialUrl: null,
    name: "test-python-course",
    newExercises: [],
    notifyAfter: 0,
    organization: "test",
    perhapsExamMode: false,
    title: "The Python Course",
    ...overrides,
  }
}

function moocCourse(
  overrides: Partial<storage.MoocLocalCourseData> = {},
): storage.MoocLocalCourseData {
  return {
    id: "instance-uuid-1",
    name: "mooc-python-course",
    title: "Mooc Python",
    description: "Mooc description",
    organization: "mooc",
    exercises: [
      moocExercise({ id: "exercise-uuid-1", name: "mooc_hello" }),
      moocExercise({ id: "exercise-uuid-2", name: "mooc_other" }),
    ],
    availablePoints: 2,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
    ...overrides,
  }
}

async function makeUserData(data: storage.UserData): Promise<[UserData, Storage]> {
  const context = createMockContext()
  const store = new Storage(context)
  await store.updateUserData(data)
  return [new UserData(store), store]
}

// -------------------------------------------------------------------------------------------------
// Bug 1 regression: `getPassed` used an object-keyed Set, so membership never matched.
// -------------------------------------------------------------------------------------------------

suite("UserData passed-state (Bug 1 regression)", function () {
  test("getPassed returns true for a tmc exercise stored as passed", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, passed: true })] })],
      mooc_courses: [],
    })
    // A freshly built identifier must still match — object identity would miss.
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(true)
  })

  test("getPassed returns false for a tmc exercise not passed", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, passed: false })] })],
      mooc_courses: [],
    })
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(false)
  })

  test("getPassed returns true for a mooc exercise stored as passed", async function () {
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [
        moocCourse({ exercises: [moocExercise({ id: "exercise-uuid-1", passed: true })] }),
      ],
    })
    expect(userData.getPassed(ExerciseIdentifier.from("exercise-uuid-1"))).toBe(true)
  })

  test("getPassed does not collide across backends with identical string ids", async function () {
    // A tmc id of 1 stringifies to "1"; a mooc id of "1" also stringifies to
    // "1". The passed lookup must not conflate the two backends.
    const [userData] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, passed: true })] })],
      mooc_courses: [moocCourse({ exercises: [moocExercise({ id: "1", passed: false })] })],
    })
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(true)
    expect(userData.getPassed(ExerciseIdentifier.from("1"))).toBe(false)
  })

  test("updateExercises flips passed-state on and off", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, passed: false })] })],
      mooc_courses: [],
    })
    const passed: LocalCourseExercise = makeTmcKind(tmcExercise({ id: 1, passed: true }))
    await userData.updateExercises(CourseIdentifier.from(0), [passed])
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(true)

    const notPassed: LocalCourseExercise = makeTmcKind(tmcExercise({ id: 1, passed: false }))
    await userData.updateExercises(CourseIdentifier.from(0), [notPassed])
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(false)
  })

  test("updateExercises does not throw when the course already exists", async function () {
    // Regression: updateExercises used to call addCourse on the existing
    // course, which throws "Trying to add an already existing course" — so the
    // whole course-update flow crashed. updateExercises is only ever called on
    // an already-added course.
    const [userData] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, name: "hello_world" })] })],
      mooc_courses: [],
    })
    const updated: LocalCourseExercise = makeTmcKind(
      tmcExercise({ id: 1, name: "hello_world", awardedPoints: 1, passed: true }),
    )
    const result = await userData.updateExercises(CourseIdentifier.from(0), [updated])
    expect(result.ok).toBe(true)
    const course = userData.getTmcCourse(0)
    expect(course.exercises.find((x) => x.id === 1)?.awardedPoints).toBe(1)
  })

  test("passed-state survives a persistence round-trip", async function () {
    const [, store] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, passed: true })] })],
      mooc_courses: [],
    })
    // A second UserData built over the same storage must observe the passed flag.
    const reloaded = new UserData(store)
    expect(reloaded.getPassed(ExerciseIdentifier.from(1))).toBe(true)
  })
})

// -------------------------------------------------------------------------------------------------
// Bug 2 regression: `clearFromNewExercises` diffed identifier objects by reference, so nothing
// was ever cleared; the write-back also never reset a fully-cleared list.
// -------------------------------------------------------------------------------------------------

suite("UserData clearFromNewExercises (Bug 2 regression)", function () {
  test("clears a subset of new tmc exercises and keeps the remainder", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ newExercises: [2, 3, 4] })],
      mooc_courses: [],
    })
    await userData.clearFromNewExercises(CourseIdentifier.from(0), [ExerciseIdentifier.from(2)])
    expect(userData.getTmcCourse(0).newExercises).toEqual([3, 4])
  })

  test("clears all new tmc exercises and resets the notify timer", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ newExercises: [2, 3, 4], notifyAfter: 1234 })],
      mooc_courses: [],
    })
    await userData.clearFromNewExercises(CourseIdentifier.from(0), [
      ExerciseIdentifier.from(2),
      ExerciseIdentifier.from(3),
      ExerciseIdentifier.from(4),
    ])
    const course = userData.getTmcCourse(0)
    expect(course.newExercises).toEqual([])
    expect(course.notifyAfter).toBe(0)
  })

  test("writes back cleared mooc exercises as string ids", async function () {
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [moocCourse({ newExercises: ["a", "b", "c"] })],
    })
    await userData.clearFromNewExercises(CourseIdentifier.from("instance-uuid-1"), [
      ExerciseIdentifier.from("a"),
    ])
    const course = userData.getMoocCourses()[0]
    expect(course?.newExercises).toEqual(["b", "c"])
  })

  test("clears the whole list and notify timer when no ids are given", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ newExercises: [2, 3, 4], notifyAfter: 1234 })],
      mooc_courses: [],
    })
    await userData.clearFromNewExercises(CourseIdentifier.from(0))
    const course = userData.getTmcCourse(0)
    expect(course.newExercises).toEqual([])
    expect(course.notifyAfter).toBe(0)
  })
})

// -------------------------------------------------------------------------------------------------
// General UserData surface: construction, CRUD, updateExercises, persistence, both backends
// -------------------------------------------------------------------------------------------------

suite("UserData construction", function () {
  test("starts empty when storage has no user data", function () {
    const userData = new UserData(new Storage(createMockContext()))
    expect(userData.getCourses()).toEqual([])
    expect(userData.getTmcCourses()).toEqual([])
    expect(userData.getMoocCourses()).toEqual([])
  })

  test("loads tmc and mooc courses from storage", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse()], mooc_courses: [moocCourse()] })
    expect(userData.getTmcCourses()).toHaveLength(1)
    expect(userData.getMoocCourses()).toHaveLength(1)
    const kinds = userData.getCourses().map((c) => c.kind)
    expect(kinds).toEqual(["tmc", "mooc"])
  })
})

suite("UserData course add/get/update/delete", function () {
  test("adds a tmc course and reads it back by identifier and slug", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    await userData.addCourse(makeTmcKind(tmcCourse({ id: 7, name: "algorithms" })))
    expect(userData.getCourse(CourseIdentifier.from(7)).unwrap().data.name).toBe("algorithms")
    expect(userData.getCourseBySlug("tmc", "algorithms").unwrap().kind).toBe("tmc")
    expect(userData.getTmcCourseByName("algorithms")?.id).toBe(7)
  })

  test("adds a mooc course and reads it back by identifier and slug", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    await userData.addCourse(makeMoocKind(moocCourse({ id: "inst-9", name: "mooc-algo" })))
    expect(userData.getCourse(CourseIdentifier.from("inst-9")).unwrap().data.name).toBe("mooc-algo")
    expect(userData.getCourseBySlug("mooc", "mooc-algo").unwrap().kind).toBe("mooc")
  })

  test("an added course's passed exercises read as passed", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    await userData.addCourse(
      makeTmcKind(tmcCourse({ id: 7, exercises: [tmcExercise({ id: 1, passed: true })] })),
    )
    await userData.addCourse(
      makeMoocKind(
        moocCourse({ id: "inst-9", exercises: [moocExercise({ id: "m", passed: true })] }),
      ),
    )
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(true)
    expect(userData.getPassed(ExerciseIdentifier.from("m"))).toBe(true)
  })

  test("rejects adding a duplicate tmc course", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse({ id: 0 })], mooc_courses: [] })
    const result = await userData.addCourse(makeTmcKind(tmcCourse({ id: 0 })))
    expect(result.err).toBe(true)
  })

  test("rejects adding a duplicate mooc course", async function () {
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    const result = await userData.addCourse(makeMoocKind(moocCourse({ id: "instance-uuid-1" })))
    expect(result.err).toBe(true)
  })

  test("getCourse errs for a nonexistent course", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    expect(userData.getCourse(CourseIdentifier.from(123)).err).toBe(true)
    expect(userData.getCourse(CourseIdentifier.from("nope")).err).toBe(true)
    expect(userData.getCourseBySlug("tmc", "nope").err).toBe(true)
    expect(userData.getCourseBySlug("mooc", "nope").err).toBe(true)
  })

  test("updateCourse overwrites tmc course data", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse({ id: 0 })], mooc_courses: [] })
    await userData.updateCourse(makeTmcKind(tmcCourse({ id: 0, title: "Renamed" })))
    expect(userData.getTmcCourse(0).title).toBe("Renamed")
  })

  test("updateCourse errs for a course that does not exist", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    const result = await userData.updateCourse(makeTmcKind(tmcCourse({ id: 5 })))
    expect(result.err).toBe(true)
  })

  test("deleteCourse removes tmc and mooc courses", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    await userData.deleteCourse(CourseIdentifier.from(0))
    await userData.deleteCourse(CourseIdentifier.from("instance-uuid-1"))
    expect(userData.getTmcCourses()).toEqual([])
    expect(userData.getMoocCourses()).toEqual([])
  })

  test("setNewExerciseNotifyAfter updates the notify timer for both backends", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    await userData.setNewExerciseNotifyAfter(CourseIdentifier.from(0), 111)
    await userData.setNewExerciseNotifyAfter(CourseIdentifier.from("instance-uuid-1"), 222)
    expect(userData.getTmcCourse(0).notifyAfter).toBe(111)
    expect(userData.getMoocCourses()[0]?.notifyAfter).toBe(222)
  })
})

suite("UserData updateExercises", function () {
  test("records genuinely new tmc exercises and replaces the exercise list", async function () {
    const [userData] = await makeUserData({
      courses: [
        tmcCourse({
          id: 0,
          newExercises: [],
          exercises: [tmcExercise({ id: 1 }), tmcExercise({ id: 2 })],
        }),
      ],
      mooc_courses: [],
    })
    const exercises: LocalCourseExercise[] = [
      makeTmcKind(tmcExercise({ id: 1 })),
      makeTmcKind(tmcExercise({ id: 2 })),
      makeTmcKind(tmcExercise({ id: 3, name: "new_one" })),
    ]
    await userData.updateExercises(CourseIdentifier.from(0), exercises)
    const course = userData.getTmcCourse(0)
    expect(course.exercises.map((x) => x.id)).toEqual([1, 2, 3])
    // id 3 is new relative to the previously stored [1, 2]
    expect(course.newExercises).toEqual([3])
  })

  test("records genuinely new mooc exercises", async function () {
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [
        moocCourse({
          id: "instance-uuid-1",
          newExercises: [],
          exercises: [moocExercise({ id: "a" }), moocExercise({ id: "b" })],
        }),
      ],
    })
    const exercises: LocalCourseExercise[] = [
      makeMoocKind(moocExercise({ id: "a" })),
      makeMoocKind(moocExercise({ id: "b" })),
      makeMoocKind(moocExercise({ id: "c", name: "new_mooc" })),
    ]
    await userData.updateExercises(CourseIdentifier.from("instance-uuid-1"), exercises)
    const course = userData.getMoocCourses()[0]
    expect(course?.exercises.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(course?.newExercises).toEqual(["c"])
  })
  test("lists an exercise once when it was already new but not yet stored", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 0, newExercises: [3], exercises: [tmcExercise({ id: 1 })] })],
      mooc_courses: [
        moocCourse({
          id: "instance-uuid-1",
          newExercises: ["c"],
          exercises: [moocExercise({ id: "a" })],
        }),
      ],
    })
    await userData.updateExercises(CourseIdentifier.from(0), [
      makeTmcKind(tmcExercise({ id: 1 })),
      makeTmcKind(tmcExercise({ id: 3, name: "new_one" })),
    ])
    await userData.updateExercises(CourseIdentifier.from("instance-uuid-1"), [
      makeMoocKind(moocExercise({ id: "a" })),
      makeMoocKind(moocExercise({ id: "c", name: "new_mooc" })),
    ])
    expect(userData.getTmcCourse(0).newExercises).toEqual([3])
    expect(userData.getMoocCourses()[0]?.newExercises).toEqual(["c"])
  })
})

suite("UserData mixed-backend isolation", function () {
  test("tmc and mooc courses with the same numeric-looking id do not collide", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 1, name: "tmc-course" })],
      mooc_courses: [moocCourse({ id: "1", name: "mooc-course" })],
    })
    expect(userData.getCourse(CourseIdentifier.from(1)).unwrap().data.name).toBe("tmc-course")
    expect(userData.getCourse(CourseIdentifier.from("1")).unwrap().data.name).toBe("mooc-course")
    // Deleting the tmc course must leave the mooc course untouched.
    await userData.deleteCourse(CourseIdentifier.from(1))
    expect(userData.getTmcCourses()).toEqual([])
    expect(userData.getMoocCourses()).toHaveLength(1)
  })
})

suite("UserData persistence round-trip", function () {
  test("added courses are written to storage and reloadable", async function () {
    const store = new Storage(createMockContext())
    const userData = new UserData(store)
    expect(
      (await userData.addCourse(makeTmcKind(tmcCourse({ id: 4, name: "persisted-tmc" })))).ok,
    ).toBe(true)
    expect(
      (await userData.addCourse(makeMoocKind(moocCourse({ id: "inst-4", name: "persisted-mooc" }))))
        .ok,
    ).toBe(true)

    const persisted = store.getUserData()
    expect(persisted?.courses.map((c) => c.id)).toEqual([4])
    expect(persisted?.mooc_courses.map((c) => c.id)).toEqual(["inst-4"])

    const reloaded = new UserData(store)
    expect(reloaded.getCourse(CourseIdentifier.from(4)).unwrap().data.name).toBe("persisted-tmc")
    expect(reloaded.getCourse(CourseIdentifier.from("inst-4")).unwrap().data.name).toBe(
      "persisted-mooc",
    )
  })
})

// -------------------------------------------------------------------------------------------------
// Bug 3 regression: the by-slug lookups scanned tmc courses first and returned as soon as a
// *course* slug matched, even when the requested exercise was not in that course. A mooc course
// sharing its slug with a tmc course was therefore unreachable — the tmc course short-circuited
// the search. Both lookups are now qualified by the backend the caller already knows.
// -------------------------------------------------------------------------------------------------

suite("UserData slug collision across backends (Bug 3 regression)", function () {
  /** A tmc course and a mooc course that share the slug `shared-slug`. */
  async function collidingCourses(): Promise<UserData> {
    const [userData] = await makeUserData({
      courses: [
        tmcCourse({
          id: 11,
          name: "shared-slug",
          exercises: [tmcExercise({ id: 101, name: "tmc_only" })],
        }),
      ],
      mooc_courses: [
        moocCourse({
          id: "inst-11",
          name: "shared-slug",
          exercises: [moocExercise({ id: "mooc-ex-uuid", name: "mooc_only" })],
        }),
      ],
    })
    return userData
  }

  test("finds the mooc exercise of a slug-colliding course", async function () {
    const userData = await collidingCourses()
    const exercise = userData.getExerciseByName("mooc", "shared-slug", "mooc_only")
    expect(exercise?.kind).toBe("mooc")
    expect(exercise?.data.id).toBe("mooc-ex-uuid")
  })

  test("finds the tmc exercise of a slug-colliding course", async function () {
    const userData = await collidingCourses()
    const exercise = userData.getExerciseByName("tmc", "shared-slug", "tmc_only")
    expect(exercise?.kind).toBe("tmc")
    expect(exercise?.data.id).toBe(101)
  })

  test("does not cross backends: a tmc-only exercise is not found under mooc", async function () {
    const userData = await collidingCourses()
    expect(userData.getExerciseByName("mooc", "shared-slug", "tmc_only")).toBeUndefined()
    expect(userData.getExerciseByName("tmc", "shared-slug", "mooc_only")).toBeUndefined()
  })

  test("resolves the slug-colliding course itself per backend", async function () {
    const userData = await collidingCourses()
    expect(userData.getCourseBySlug("mooc", "shared-slug").unwrap().data.id).toBe("inst-11")
    expect(userData.getCourseBySlug("tmc", "shared-slug").unwrap().data.id).toBe(11)
  })

  test("keeps searching past a slug-matching course that lacks the exercise", async function () {
    // Two enrolled mooc *instances* of the same course share a slug; only the
    // second one holds the exercise being looked up.
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [
        moocCourse({ id: "inst-a", name: "two-instances", exercises: [] }),
        moocCourse({
          id: "inst-b",
          name: "two-instances",
          exercises: [moocExercise({ id: "late-uuid", name: "mooc_late" })],
        }),
      ],
    })
    expect(userData.getMoocExerciseByName("two-instances", "mooc_late")?.id).toBe("late-uuid")
  })
})

// -------------------------------------------------------------------------------------------------
// The in-memory catalogue and the persisted one must agree: `getPassed` answers from a set that a
// single-exercise write has to update too, and a rejected write must not read back as a success.
// -------------------------------------------------------------------------------------------------

suite("UserData setExerciseAsPassed", function () {
  test("a passed tmc exercise reads back as passed from memory and from storage", async function () {
    const [userData, store] = await makeUserData({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, name: "hello_world" })] })],
      mooc_courses: [],
    })
    const result = await userData.setExerciseAsPassed("tmc", "test-python-course", "hello_world")
    expect(result.ok).toBe(true)
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(true)
    expect(store.getUserData()?.courses[0]?.exercises[0]?.passed).toBe(true)
  })

  test("a passed mooc exercise reads back as passed from memory and from storage", async function () {
    const [userData, store] = await makeUserData({
      courses: [],
      mooc_courses: [
        moocCourse({ exercises: [moocExercise({ id: "exercise-uuid-1", name: "mooc_hello" })] }),
      ],
    })
    const result = await userData.setExerciseAsPassed("mooc", "mooc-python-course", "mooc_hello")
    expect(result.ok).toBe(true)
    expect(userData.getPassed(ExerciseIdentifier.from("exercise-uuid-1"))).toBe(true)
    expect(store.getUserData()?.mooc_courses[0]?.exercises[0]?.passed).toBe(true)
  })

  test("does not reach across backends for a shared slug and exercise name", async function () {
    const [userData] = await makeUserData({
      courses: [
        tmcCourse({ id: 11, name: "shared", exercises: [tmcExercise({ id: 1, name: "ex" })] }),
      ],
      mooc_courses: [
        moocCourse({
          id: "inst-11",
          name: "shared",
          exercises: [moocExercise({ id: "m", name: "ex" })],
        }),
      ],
    })
    await userData.setExerciseAsPassed("mooc", "shared", "ex")
    expect(userData.getPassed(ExerciseIdentifier.from("m"))).toBe(true)
    expect(userData.getPassed(ExerciseIdentifier.from(1))).toBe(false)
  })

  test("errs when the exercise is not in the catalogue", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse()], mooc_courses: [] })
    const result = await userData.setExerciseAsPassed("tmc", "test-python-course", "no_such")
    expect(result.err).toBe(true)
  })
})

suite("UserData concurrent writes", function () {
  test("chains overlapping writes instead of letting them interleave", async function () {
    const [userData, store] = await makeUserData({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [],
    })
    const events: string[] = []
    let writeCount = 0
    vi.spyOn(store, "updateUserData").mockImplementation(async () => {
      const write = ++writeCount
      events.push(`start${write}`)
      // The first write is the slower one, so an unserialized second write
      // would finish inside it.
      await new Promise((resolve) => {
        setTimeout(resolve, write === 1 ? 10 : 0)
      })
      events.push(`end${write}`)
    })

    await Promise.all([
      userData.setNewExerciseNotifyAfter(CourseIdentifier.from(0), 111),
      userData.setNewExerciseNotifyAfter(CourseIdentifier.from(0), 222),
    ])

    expect(events).toEqual(["start1", "end1", "start2", "end2"])
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })
})

suite("UserData write failures", function () {
  /** A `UserData` whose every persistence write rejects. */
  async function withFailingWrites(
    data: storage.UserData,
  ): Promise<[UserData, ReturnType<typeof vi.fn>]> {
    const [userData, store] = await makeUserData(data)
    const updateUserData = vi.fn(async () => {
      throw new Error("globalState is full")
    })
    vi.spyOn(store, "updateUserData").mockImplementation(updateUserData)
    return [userData, updateUserData]
  }

  test("addCourse reports the failed write instead of appearing to succeed", async function () {
    const [userData, updateUserData] = await withFailingWrites({ courses: [], mooc_courses: [] })
    const result = await userData.addCourse(makeTmcKind(tmcCourse({ id: 7 })))
    expect(updateUserData).toHaveBeenCalledOnce()
    expect(result.err).toBe(true)
  })

  test("deleteCourse reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [],
    })
    const result = await userData.deleteCourse(CourseIdentifier.from(0))
    expect(result.err).toBe(true)
  })

  test("updateCourse reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [],
    })
    const result = await userData.updateCourse(makeTmcKind(tmcCourse({ id: 0, title: "New" })))
    expect(result.err).toBe(true)
  })

  test("setExerciseAsPassed reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ exercises: [tmcExercise({ id: 1, name: "hello_world" })] })],
      mooc_courses: [],
    })
    const result = await userData.setExerciseAsPassed("tmc", "test-python-course", "hello_world")
    expect(result.err).toBe(true)
  })

  test("setNewExerciseNotifyAfter reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [],
    })
    const result = await userData.setNewExerciseNotifyAfter(CourseIdentifier.from(0), 111)
    expect(result.err).toBe(true)
  })

  test("clearFromNewExercises reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ id: 0, newExercises: [2] })],
      mooc_courses: [],
    })
    const result = await userData.clearFromNewExercises(CourseIdentifier.from(0))
    expect(result.err).toBe(true)
  })

  test("updateExercises reports the failed write", async function () {
    const [userData] = await withFailingWrites({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [],
    })
    const result = await userData.updateExercises(CourseIdentifier.from(0), [
      makeTmcKind(tmcExercise({ id: 1 })),
    ])
    expect(result.err).toBe(true)
  })
})

suite("UserData construction over unreadable storage", function () {
  test("lets the corrupt-data error through so activation can degrade", function () {
    const context = createMockContext()
    context.globalState.update(USER_DATA_KEY, { courses: "not an array" })
    expect(() => new UserData(new Storage(context))).toThrow(CorruptStoredDataError)
  })
})
