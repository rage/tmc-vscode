import { UserData } from "../../config/userdata"
import type { LocalCourseExercise } from "../../shared/shared"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
} from "../../shared/shared"
import Storage from "../../storage"
import type * as storage from "../../storage/data"
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
    userData.addCourse(makeTmcKind(tmcCourse({ id: 7, name: "algorithms" })))
    expect(userData.getCourse(CourseIdentifier.from(7)).data.name).toBe("algorithms")
    expect(userData.getCourseBySlug("algorithms").kind).toBe("tmc")
    expect(userData.getTmcCourseByName("algorithms")?.id).toBe(7)
  })

  test("adds a mooc course and reads it back by identifier and slug", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    userData.addCourse(makeMoocKind(moocCourse({ id: "inst-9", name: "mooc-algo" })))
    expect(userData.getCourse(CourseIdentifier.from("inst-9")).data.name).toBe("mooc-algo")
    expect(userData.getCourseBySlug("mooc-algo").kind).toBe("mooc")
  })

  test("rejects adding a duplicate tmc course", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse({ id: 0 })], mooc_courses: [] })
    expect(() => userData.addCourse(makeTmcKind(tmcCourse({ id: 0 })))).toThrow(/already existing/)
  })

  test("rejects adding a duplicate mooc course via addMoocCourse", async function () {
    const [userData] = await makeUserData({
      courses: [],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    expect(() => userData.addMoocCourse(moocCourse({ id: "instance-uuid-1" }))).toThrow(
      /already existing/,
    )
  })

  test("getCourse throws for a nonexistent course", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    expect(() => userData.getCourse(CourseIdentifier.from(123))).toThrow(/nonexistent/)
    expect(() => userData.getCourse(CourseIdentifier.from("nope"))).toThrow(/nonexistent/)
  })

  test("updateCourse overwrites tmc course data", async function () {
    const [userData] = await makeUserData({ courses: [tmcCourse({ id: 0 })], mooc_courses: [] })
    await userData.updateCourse(makeTmcKind(tmcCourse({ id: 0, title: "Renamed" })))
    expect(userData.getTmcCourse(0).title).toBe("Renamed")
  })

  test("updateCourse throws for a course that does not exist", async function () {
    const [userData] = await makeUserData({ courses: [], mooc_courses: [] })
    await expect(userData.updateCourse(makeTmcKind(tmcCourse({ id: 5 })))).rejects.toThrow(
      /doesn't exist/,
    )
  })

  test("deleteCourse removes tmc and mooc courses", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    userData.deleteCourse(CourseIdentifier.from(0))
    userData.deleteCourse(CourseIdentifier.from("instance-uuid-1"))
    expect(userData.getTmcCourses()).toEqual([])
    expect(userData.getMoocCourses()).toEqual([])
  })

  test("setNotifyDate updates the notify timer for both backends", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 0 })],
      mooc_courses: [moocCourse({ id: "instance-uuid-1" })],
    })
    await userData.setNotifyDate(CourseIdentifier.from(0), 111)
    await userData.setNotifyDate(CourseIdentifier.from("instance-uuid-1"), 222)
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
})

suite("UserData mixed-backend isolation", function () {
  test("tmc and mooc courses with the same numeric-looking id do not collide", async function () {
    const [userData] = await makeUserData({
      courses: [tmcCourse({ id: 1, name: "tmc-course" })],
      mooc_courses: [moocCourse({ id: "1", name: "mooc-course" })],
    })
    expect(userData.getCourse(CourseIdentifier.from(1)).data.name).toBe("tmc-course")
    expect(userData.getCourse(CourseIdentifier.from("1")).data.name).toBe("mooc-course")
    // Deleting the tmc course must leave the mooc course untouched.
    userData.deleteCourse(CourseIdentifier.from(1))
    expect(userData.getTmcCourses()).toEqual([])
    expect(userData.getMoocCourses()).toHaveLength(1)
  })
})

suite("UserData persistence round-trip", function () {
  test("added courses are written to storage and reloadable", async function () {
    const store = new Storage(createMockContext())
    const userData = new UserData(store)
    userData.addCourse(makeTmcKind(tmcCourse({ id: 4, name: "persisted-tmc" })))
    userData.addCourse(makeMoocKind(moocCourse({ id: "inst-4", name: "persisted-mooc" })))
    // Let the async persistence settle, then reload from the same storage.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const persisted = store.getUserData()
    expect(persisted?.courses.map((c) => c.id)).toEqual([4])
    expect(persisted?.mooc_courses.map((c) => c.id)).toEqual(["inst-4"])

    const reloaded = new UserData(store)
    expect(reloaded.getCourse(CourseIdentifier.from(4)).data.name).toBe("persisted-tmc")
    expect(reloaded.getCourse(CourseIdentifier.from("inst-4")).data.name).toBe("persisted-mooc")
  })
})
