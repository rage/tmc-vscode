import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { CourseIdentifier, LocalCourseData } from "../../../shared/lib"
import { LocalCourseData as LocalCourseDataNs } from "../../../shared/lib"
import type { ReadyActionContext } from "../../actions/types"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { buildCourseHomeView } from "../../ui/courseHome"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { recentUpdates } from "../../ui/recentUpdates"
import type CoursesTree from "../../ui/treeview/treeview"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
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
import { createMockActionContext } from "../mocks/actionContext"

const NOW = new Date("2026-06-01T12:00:00Z")

// jest-mock-vscode ships no `env` namespace.
beforeAll(function () {
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", { value: { language: "en" }, configurable: true })
})

afterEach(function () {
  updateablesRegistry.clear()
  recentUpdates.dismiss(idOfTmcCourse(42))
  setTrusted(true)
})

function setTrusted(isTrusted: boolean): void {
  Object.defineProperty(vscode.workspace, "isTrusted", { value: isTrusted, configurable: true })
}

interface Situation {
  onDisk?: WorkspaceExercise[]
  /** The course whose workspace this window is. */
  openCourse?: LocalCourseData
  isReachable?: boolean
  isLoggedIn?: boolean
}

function contextFor(course: LocalCourseData, situation: Situation = {}): ReadyActionContext {
  const { openCourse } = situation
  return {
    ...createMockActionContext({
      loggedIn: situation.isLoggedIn ?? true,
      startup: {
        userData: {
          getCourse: (id: CourseIdentifier) =>
            id.kind === course.kind ? Ok(course) : Err(new Error("No such course.")),
          getCourseBySlug: () => (openCourse ? Ok(openCourse) : Err(new Error("none"))),
        } as unknown as UserData,
        workspaceManager: {
          activeCourse: openCourse && LocalCourseDataNs.getCourseName(openCourse),
          activeCourseBackend: openCourse?.kind,
          getExercises: () => situation.onDisk ?? [],
        } as unknown as WorkspaceManager,
      },
    }),
    coursesTree: {
      isBackendReachable: () => situation.isReachable ?? true,
    } as unknown as CoursesTree,
  }
}

function onDisk(id: number, exerciseSlug: string, status: ExerciseStatus): WorkspaceExercise {
  return {
    id: idOfTmcExercise(id),
    courseId: idOfTmcCourse(42),
    backend: "tmc",
    courseSlug: "python-course",
    exerciseSlug,
    status,
    uri: vscode.Uri.file(`/exercises/${exerciseSlug}`),
  }
}

suite("buildCourseHomeView", function () {
  test("gives each mooc row its tries and why a submission would be refused, and a locked chapter its lock", function () {
    const course = moocLocalCourse({
      exercises: [
        moocCourseExercise({
          id: "a",
          name: "loops",
          maxTries: 3,
          triesLeft: 2,
          chapter: { name: "Basics", number: 1 },
        }),
        moocCourseExercise({
          id: "b",
          name: "recursion",
          chapter: { name: "Advanced", number: 2, lockingStatus: "CompletedAndLocked" },
        }),
      ],
    })

    const view = buildCourseHomeView(
      contextFor(course),
      idOfMoocCourse(MOOC_COURSE_ID),
      NOW,
    ).unwrap()

    const [basics, advanced] = view.parts
    expect(basics?.lockedReason).toBeUndefined()
    expect(basics?.exercises[0]).toMatchObject({ triesLeft: 2 })
    expect(basics?.exercises[0]).not.toHaveProperty("submitRefusal")
    expect(advanced?.lockedReason).toBe("You have completed and locked this chapter.")
    expect(advanced?.exercises[0]?.submitRefusal).toEqual({
      label: "chapter locked",
      sentence:
        'You have completed and locked the chapter "Advanced", so recursion can no longer be submitted.',
    })
  })

  test("says a review can change points already given, without calling them held back", function () {
    const course = moocLocalCourse({
      exercises: [
        moocCourseExercise({
          id: "a",
          name: "loops",
          awardedPoints: 1,
          pendingReview: "awaits_chapter_lock",
        }),
      ],
    })

    const view = buildCourseHomeView(
      contextFor(course),
      idOfMoocCourse(MOOC_COURSE_ID),
      NOW,
    ).unwrap()

    expect(view.parts[0]?.exercises[0]).toMatchObject({
      awardedPoints: 1,
      pendingReview:
        "A teacher reviews this answer once you complete and lock the chapter, which can change the points.",
    })
  })

  test("says what the points of an exercise under review wait for, and why it is locked", function () {
    const course = moocLocalCourse({
      exercises: [
        moocCourseExercise({
          id: "a",
          name: "loops",
          pendingReview: "awaits_teacher",
          exerciseLocked: true,
        }),
      ],
    })

    const view = buildCourseHomeView(
      contextFor(course),
      idOfMoocCourse(MOOC_COURSE_ID),
      NOW,
    ).unwrap()

    expect(view.parts[0]?.exercises[0]).toMatchObject({
      pendingReview: "The points wait for a teacher's review.",
      submitRefusal: {
        label: "locked",
        sentence:
          "loops is locked for you, so it can no longer be submitted. Only a teacher can unlock it.",
      },
    })
  })

  test("groups a tmc course by part, with each exercise's state on this computer", function () {
    const course = tmcLocalCourse({
      title: "Python Course",
      organization: "mooc",
      awardedPoints: 1,
      availablePoints: 3,
      exercises: [
        tmcCourseExercise({ id: 1, name: "part01-01_hello", passed: true, awardedPoints: 1 }),
        tmcCourseExercise({ id: 2, name: "part01-02_loops" }),
        tmcCourseExercise({ id: 3, name: "part02-01_lists" }),
      ],
      newExercises: [3],
    })

    const view = buildCourseHomeView(
      contextFor(course, { onDisk: [onDisk(1, "part01-01_hello", ExerciseStatus.Open)] }),
      idOfTmcCourse(42),
      NOW,
    ).unwrap()

    expect(view).toMatchObject({
      backend: "tmc",
      title: "Python Course",
      organization: "mooc",
      awardedPoints: 1,
      availablePoints: 3,
      isExamMode: false,
      isWorkspaceOpen: false,
      newExercises: [{ id: idOfTmcExercise(3), name: "01_lists" }],
    })
    expect(view.parts.map((part) => part.name)).toEqual(["Part 1", "Part 2"])
    expect(view.parts.flatMap((part) => part.exercises.map((ex) => [ex.name, ex.status]))).toEqual([
      ["01_hello", "opened"],
      ["02_loops", "missing"],
      ["01_lists", "new"],
    ])
  })

  test("shows an exercise downloading while its download runs", async function () {
    const course = tmcLocalCourse({ exercises: [tmcCourseExercise({ id: 1 })] })
    const download = Promise.withResolvers<Ok<undefined>>()
    const running = exerciseOperations.run(
      idOfTmcExercise(1),
      "downloading",
      () => download.promise,
    )

    const view = buildCourseHomeView(contextFor(course), idOfTmcCourse(42), NOW).unwrap()
    download.resolve(Ok(undefined))
    await running

    expect(view.parts[0]?.exercises[0]?.status).toBe("downloading")
  })

  test("lists the updates the last check found, and what an automatic update replaced", function () {
    const course = tmcLocalCourse({
      exercises: [tmcCourseExercise({ id: 1, name: "part01-01_hello" })],
    })
    updateablesRegistry.setMany([[idOfTmcCourse(42), [idOfTmcExercise(1)]]])
    recentUpdates.add(idOfTmcCourse(42), ["part01-02_loops"])

    const view = buildCourseHomeView(
      contextFor(course, { onDisk: [onDisk(1, "part01-01_hello", ExerciseStatus.Closed)] }),
      idOfTmcCourse(42),
      NOW,
    ).unwrap()

    expect(view.updates).toEqual([{ id: idOfTmcExercise(1), name: "01_hello" }])
    expect(view.parts[0]?.exercises[0]?.isUpdateable).toBe(true)
    expect(view.recentlyUpdated).toEqual(["part01-02_loops"])
  })

  test("describes the next deadline among the exercises still to do", function () {
    const course = tmcLocalCourse({
      exercises: [
        tmcCourseExercise({ id: 1, name: "part01-01_a", deadline: "2026-06-04T12:00:00Z" }),
        tmcCourseExercise({
          id: 2,
          name: "part01-02_b",
          deadline: "2026-06-02T12:00:00Z",
          passed: true,
        }),
      ],
    })

    const view = buildCourseHomeView(contextFor(course), idOfTmcCourse(42), NOW).unwrap()

    expect(view.nextDeadline).toMatchObject({
      at: "2026-06-04T12:00:00.000Z",
      relative: "in 3 days",
      brief: "in 3 days",
    })
    expect(view.parts[0]?.exercises[1]?.deadline?.relative).toBe("tomorrow")
  })

  test("marks a binding soft deadline, which the page then explains", function () {
    const course = tmcLocalCourse({
      exercises: [
        tmcCourseExercise({
          softDeadline: "2026-06-02T12:00:00Z",
          deadline: "2026-06-09T12:00:00Z",
        }),
      ],
    })

    const view = buildCourseHomeView(contextFor(course), idOfTmcCourse(42), NOW).unwrap()

    expect(view.hasSoftDeadlines).toBe(true)
    expect(view.parts[0]?.exercises[0]).toMatchObject({
      isSoftDeadline: true,
      deadline: { at: "2026-06-02T12:00:00.000Z" },
    })
  })

  test("carries the tmc-only exam, disabled and material flags", function () {
    const course = tmcLocalCourse({
      perhapsExamMode: true,
      disabled: true,
      materialUrl: "https://example.com/material",
    })

    const view = buildCourseHomeView(contextFor(course), idOfTmcCourse(42), NOW).unwrap()

    expect(view).toMatchObject({
      isExamMode: true,
      isDisabled: true,
      materialUrl: "https://example.com/material",
    })
  })

  test("groups a mooc course by chapter, under display names, with no tmc flags", function () {
    const course = moocLocalCourse({
      title: "MOOC Python",
      organization: "University of Helsinki",
      exercises: [
        moocCourseExercise({
          id: "a",
          name: "Hello world",
          chapter: { name: "Basics", number: 1 },
        }),
        moocCourseExercise({ id: "b", name: "Bonus round" }),
      ],
    })

    const view = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()

    expect(view).toMatchObject({
      backend: "mooc",
      organization: "University of Helsinki",
      isExamMode: false,
      isDisabled: false,
      isNotEnrolled: false,
      materialUrl: null,
    })
    expect(view.parts.map((part) => [part.name, part.exercises.map((ex) => ex.name)])).toEqual([
      ["Basics", ["Hello world"]],
      ["Other exercises", ["Bonus round"]],
    ])
  })

  test("links a mooc course and its exercises to their course material pages", function () {
    const pageUrl = "https://courses.mooc.fi/org/uh-cs/courses/python/chapter-1/loops"
    const course = moocLocalCourse({
      exercises: [moocCourseExercise({ id: "a", pageUrl }), moocCourseExercise({ id: "b" })],
    })

    const view = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()

    expect(view.materialUrl).toBe("https://courses.mooc.fi/org/uh-cs/courses/python")
    expect(view.parts[0]?.exercises.map((ex) => ex.materialUrl)).toEqual([pageUrl, undefined])
  })

  test("names the first exercise still left to do as the next one", function () {
    const course = moocLocalCourse({
      exercises: [
        moocCourseExercise({ id: "a", name: "done", passed: true }),
        moocCourseExercise({ id: "b", name: "spent", outOfTries: true }),
        moocCourseExercise({ id: "c", name: "closed", deadline: "2026-05-01T00:00:00Z" }),
        moocCourseExercise({ id: "r", name: "removed" }),
        moocCourseExercise({ id: "d", name: "todo" }),
      ],
    })
    updateablesRegistry.setRemoved("mooc", [idOfMoocExercise("r")])

    const view = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()

    expect(view.nextExercise?.name).toBe("todo")
  })

  test("carries that courses.mooc.fi refused the student as not enrolled", function () {
    const course = moocLocalCourse({ notEnrolled: true })

    const view = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()

    expect(view.isNotEnrolled).toBe(true)
  })

  test("calls a course whose exercises name no part just Exercises", function () {
    const course = moocLocalCourse({ exercises: [moocCourseExercise({ name: "Hello world" })] })

    const view = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()

    expect(view.parts.map((part) => part.name)).toEqual(["Exercises"])
  })

  test("knows the window is the course's workspace, and whether it is restricted", function () {
    const course = tmcLocalCourse()
    setTrusted(false)

    const own = buildCourseHomeView(
      contextFor(course, { openCourse: course }),
      idOfTmcCourse(42),
      NOW,
    ).unwrap()
    const other = buildCourseHomeView(
      contextFor(course, { openCourse: tmcLocalCourse({ id: 7, name: "other" }) }),
      idOfTmcCourse(42),
      NOW,
    ).unwrap()

    expect([own.isWorkspaceOpen, own.isRestricted]).toEqual([true, true])
    expect([other.isWorkspaceOpen, other.isRestricted]).toEqual([false, false])
  })

  test("says when the backend is unreachable or the student is logged out", function () {
    const view = buildCourseHomeView(
      contextFor(tmcLocalCourse(), { isReachable: false, isLoggedIn: false }),
      idOfTmcCourse(42),
      NOW,
    ).unwrap()

    expect([view.isOffline, view.isLoggedIn, view.isSessionExpired]).toEqual([true, false, false])
  })

  test("carries a mooc course's AI policy, and none for a tmc course", function () {
    const course = moocLocalCourse({ aiPolicy: "full_use" })
    const mooc = buildCourseHomeView(
      contextFor(course),
      LocalCourseDataNs.getCourseId(course),
      NOW,
    ).unwrap()
    const tmc = buildCourseHomeView(contextFor(tmcLocalCourse()), idOfTmcCourse(42), NOW).unwrap()

    expect(mooc.aiPolicy).toEqual({ policy: "full_use", isAiAllowed: true })
    expect(tmc.aiPolicy).toBeNull()
  })

  test("carries that the session expired", function () {
    const context = contextFor(tmcLocalCourse(), { isLoggedIn: false })
    const view = buildCourseHomeView(
      { ...context, authState: { ...context.authState, isSessionExpired: true } },
      idOfTmcCourse(42),
      NOW,
    ).unwrap()

    expect(view.isSessionExpired).toBe(true)
  })

  test("fails for a course that is not stored", function () {
    const result = buildCourseHomeView(contextFor(moocLocalCourse()), idOfTmcCourse(42), NOW)

    expect(result.err).toBe(true)
  })

  test("lists an exercise on disk whose chapter has not opened, saying when it opens", function () {
    const course = moocLocalCourse({
      closedChapters: [
        {
          name: "Recursion",
          number: 3,
          opensAt: "2026-06-03T12:00:00Z",
          exercises: [moocCourseExercise({ id: "b", name: "fib" })],
        },
      ],
    })
    const fib: WorkspaceExercise = {
      id: idOfMoocExercise("b"),
      courseId: idOfMoocCourse(MOOC_COURSE_ID),
      backend: "mooc",
      courseSlug: "mooc-course",
      exerciseSlug: "fib",
      status: ExerciseStatus.Open,
      uri: vscode.Uri.file("/exercises/mooc/fib"),
    }

    const view = buildCourseHomeView(
      contextFor(course, { onDisk: [fib] }),
      idOfMoocCourse(MOOC_COURSE_ID),
      NOW,
    ).unwrap()

    const [recursion] = view.parts
    expect(recursion?.lockedReason).toMatch(
      /^Opens on .+\. Until then its exercises can be tested but not submitted\.$/,
    )
    expect(recursion?.exercises[0]?.submitRefusal?.label).toBe("chapter not open yet")
  })
})
