import * as tmp from "tmp"
import type * as vscode from "vscode"

import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants"
import type { v0 } from "../../storage/data"
import migrateUserData from "../../storage/migration/userData"
import * as exerciseData from "../fixtures/exerciseData"
import * as userData from "../fixtures/userData"
import { createMockMemento } from "../mocks/vscode"

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData"
const USER_DATA_KEY_V0 = "userData"
const USER_DATA_KEY_V1 = "user-data-v1"

suite("User data migration", function () {
  let memento: vscode.Memento
  let root: string

  beforeEach(function () {
    memento = createMockMemento()
    root = tmp.dirSync().name
  })

  suite("between versions", function () {
    test("should succeed without any data", function () {
      expect(migrateUserData(memento).data).toBeUndefined()
    })

    test("should succeed with version 0.1.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_1_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.id).toBe(0)
      expect(migratedCourse?.description).toBe("Python Course")
      expect(migratedCourse?.exercises.length).toBe(2)
      expect(migratedCourse?.name).toBe("test-python-course")
      expect(migratedCourse?.organization).toBe("test")
      expect(migratedCourse?.title).toBe("test-python-course")
    })

    test("should succeed with version 0.2.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_2_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.availablePoints).toBe(3)
      expect(migratedCourse?.awardedPoints).toBe(0)
    })

    test("should succeed with version 0.3.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_3_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.newExercises).toEqual([2, 3, 4])
      expect(migratedCourse?.notifyAfter).toBe(1234)
    })

    test("should succeed with version 0.4.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_4_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.title).toBe("The Python Course")
    })

    test("should succeed with version 0.6.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_6_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.exercises.find((x) => x.id === 1)?.name).toBe("hello_world")
      expect(migratedCourse?.exercises.find((x) => x.id === 2)?.name).toBe("other_world")
    })

    test("should succeed with version 0.8.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_8_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.perhapsExamMode).toBe(true)
    })

    test("should succeed with version 0.9.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v0_9_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.disabled).toBe(true)
      expect(migratedCourse?.materialUrl).toBe("mooc.fi")
    })

    test("should succeed with version 1.0.0 data", async function () {
      await memento.update(USER_DATA_KEY_V0, userData.v1_0_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]
      expect(migratedCourse?.disabled).toBe(true)
      expect(migratedCourse?.materialUrl).toBe("mooc.fi")
    })

    test("should succeed with version 2.0.0 data", async function () {
      await memento.update(USER_DATA_KEY_V1, userData.v2_0_0)
      const courses = migrateUserData(memento).data?.courses
      courses?.forEach((course) => {
        course.exercises.forEach((x) => {
          expect(x.availablePoints).toBe(LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER)
          if (x.passed) {
            expect(x.awardedPoints).toBe(LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER)
          } else {
            expect(x.awardedPoints).toBe(LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER)
          }
        })
      })
    })

    test("should succeed with version 2.1.0 data", async function () {
      await memento.update(USER_DATA_KEY_V1, userData.v2_1_0)
      // v2.1.0 data migrates to v3 by gaining the required `mooc_courses` field.
      expect(migrateUserData(memento).data).toEqual(userData.v3_0_0)
    })

    test("should succeed with backwards compatible future data", async function () {
      const data = { ...userData.v2_1_0, batman: "Bruce Wayne" }
      await memento.update(USER_DATA_KEY_V1, data)
      // The unknown `batman` key is preserved through the migration; the
      // migration still adds the v3 `mooc_courses` field.
      expect(migrateUserData(memento).data).toEqual({ ...userData.v3_0_0, batman: "Bruce Wayne" })
    })
  })

  suite("with unstable data", function () {
    test("should fail if data is garbage", async function () {
      await memento.update(USER_DATA_KEY_V0, { batman: "Bruce Wayne" })
      expect(() => migrateUserData(memento)).toThrow(/mismatch/)
    })

    test("should find more exercise info from old exerciseData", async function () {
      await memento.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_1_0(root))
      await memento.update(USER_DATA_KEY_V0, userData.v0_1_0)
      const migratedCourse = migrateUserData(memento).data?.courses[0]

      const exercise1 = migratedCourse?.exercises.find((x) => x.id === 1)
      expect(exercise1?.deadline).toBe("20201214")
      expect(exercise1?.name).toBe("hello_world")
      expect(exercise1?.softDeadline).toBeNull()

      const exercise2 = migratedCourse?.exercises.find((x) => x.id === 2)
      expect(exercise2?.deadline).toBe("20201214")
      expect(exercise2?.name).toBe("other_world")
      expect(exercise2?.softDeadline).toBeNull()
    })

    test("should successfully map unstable data with multiple courses", async function () {
      const courses: v0.LocalCourseData[] = [
        {
          id: 0,
          description: "",
          exercises: [
            { id: 1, passed: false },
            { id: 2, passed: false },
          ],
          name: "test-python-course",
          organization: "test",
        },
        {
          id: 1,
          description: "",
          exercises: [
            { id: 11, passed: true },
            { id: 12, passed: false },
          ],
          name: "test-java-course",
          organization: "test",
        },
      ]
      await memento.update(USER_DATA_KEY_V0, { courses })
      const migrated = migrateUserData(memento).data?.courses
      expect(migrated?.length).toBe(2)
      expect(migrated?.find((x) => x.id === 0)?.name).toBe("test-python-course")
      expect(migrated?.find((x) => x.id === 1)?.name).toBe("test-java-course")
    })
  })

  suite("with stable data", function () {
    test("should fail with garbage version 1 data", async function () {
      await memento.update(USER_DATA_KEY_V1, { batman: "Bruce Wayne" })
      expect(() => migrateUserData(memento)).toThrow(/mismatch/)
    })
  })
})
