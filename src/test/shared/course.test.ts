import type { LocalCourseExercise, SharedMoocCourseExercise } from "../../../shared/lib"
import {
  isSoftDeadlineBinding,
  LocalCourseData,
  makeMoocKind,
  makeTmcKind,
  moocCourseUrlOf,
  SharedMoocCourseExerciseSchema,
  SUBMIT_REFUSAL_LABELS,
  SUBMIT_REFUSAL_PRIORITY,
  submitRefusalOf,
  submitRefusalSentence,
  triesLeftText,
} from "../../../shared/lib"

suite("isSoftDeadlineBinding", () => {
  const early = "2026-10-01T00:00:00Z"
  const late = "2026-10-08T00:00:00Z"

  test("binds when it comes before the hard deadline", () => {
    expect(isSoftDeadlineBinding({ softDeadline: early, deadline: late })).toBe(true)
  })

  test("does not bind at or after the hard deadline", () => {
    expect(isSoftDeadlineBinding({ softDeadline: late, deadline: early })).toBe(false)
    expect(isSoftDeadlineBinding({ softDeadline: late, deadline: late })).toBe(false)
  })

  test("does not bind without both deadlines", () => {
    expect(isSoftDeadlineBinding({ softDeadline: early, deadline: null })).toBe(false)
    expect(isSoftDeadlineBinding({ softDeadline: null, deadline: late })).toBe(false)
  })
})

suite("moocCourseUrlOf", () => {
  test("cuts a material page's URL down to its course's", () => {
    expect(
      moocCourseUrlOf("https://courses.mooc.fi/org/uh-cs/courses/python/chapter-1/loops?x=1"),
    ).toBe("https://courses.mooc.fi/org/uh-cs/courses/python")
  })

  test("names no course for a URL laid out otherwise, or no URL at all", () => {
    expect(moocCourseUrlOf("https://courses.mooc.fi/somewhere/else")).toBeUndefined()
    expect(moocCourseUrlOf("not a url")).toBeUndefined()
  })
})

function mooc(data: Partial<SharedMoocCourseExercise>): LocalCourseExercise {
  return makeMoocKind({
    id: "exercise",
    name: "loops",
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    passed: false,
    ...data,
  })
}

const courseWithAccess = (accessLoss?: "forbidden" | "notFound"): LocalCourseData =>
  makeMoocKind({
    id: "course",
    name: "course",
    title: "Course",
    description: null,
    organization: "org",
    aiPolicy: "not_set" as const,
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    newExercises: [],
    notifyAfter: 0,
    notEnrolled: true,
    ...(accessLoss ? { accessLoss: { reason: accessLoss, checkedAt: 0 } } : {}),
  })

suite("submitRefusalOf", () => {
  const now = new Date("2026-11-13T12:00:00Z")

  test("refuses nothing an open exercise with tries left", () => {
    expect(submitRefusalOf(mooc({ triesLeft: 1, maxTries: 3 }), now)).toBeUndefined()
    expect(submitRefusalOf(mooc({ deadline: "2026-11-14T00:00:00Z" }), now)).toBeUndefined()
  })

  test("refuses a used-up try limit, also once passed", () => {
    expect(submitRefusalOf(mooc({ outOfTries: true }), now)).toBe("outOfTries")
    expect(submitRefusalOf(mooc({ passed: true, triesLeft: 0 }), now)).toBe("outOfTries")
  })

  test("refuses from the deadline on, before the tries", () => {
    expect(submitRefusalOf(mooc({ deadline: "2026-11-13T12:00:00Z" }), now)).toBe("deadlinePassed")
    expect(submitRefusalOf(mooc({ deadline: "2026-11-01T00:00:00Z", triesLeft: 0 }), now)).toBe(
      "deadlinePassed",
    )
  })

  test("refuses a locked chapter after the exercise's own reasons", () => {
    const chapter = { name: "Loops", number: 2 }
    expect(
      submitRefusalOf(mooc({ chapter: { ...chapter, lockingStatus: "NotUnlockedYet" } }), now),
    ).toBe("chapterNotUnlockedYet")
    expect(
      submitRefusalOf(
        mooc({ chapter: { ...chapter, lockingStatus: "NotUnlockedYet" }, triesLeft: 0 }),
        now,
      ),
    ).toBe("outOfTries")
    expect(
      submitRefusalOf(
        mooc({ chapter: { ...chapter, lockingStatus: "CompletedAndLocked" }, outOfTries: true }),
        now,
      ),
    ).toBe("outOfTries")
    expect(
      submitRefusalOf(mooc({ chapter: { ...chapter, lockingStatus: "CompletedAndLocked" } }), now),
    ).toBe("chapterCompletedAndLocked")
    expect(
      submitRefusalOf(mooc({ chapter: { ...chapter, lockingStatus: "Unlocked" } }), now),
    ).toBeUndefined()
  })

  test("refuses an exercise locked for review, with who can lift it", () => {
    expect(
      submitRefusalOf(mooc({ exerciseLocked: true, deadline: "2026-11-01T00:00:00Z" }), now),
    ).toBe("exerciseLocked")
    expect(submitRefusalSentence("exerciseLocked", "loops")).toBe(
      "The teacher has locked loops, so it can no longer be submitted.",
    )
  })

  test("refuses a tmc exercise past its hard deadline", () => {
    const tmc = makeTmcKind({
      id: 1,
      name: "part01-01_hello",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: "2026-11-01T00:00:00Z",
      passed: false,
      softDeadline: null,
    })
    expect(submitRefusalOf(tmc, now)).toBe("deadlinePassed")
  })

  test("refuses every exercise of a course its backend refuses, before anything else", () => {
    const passedOut = mooc({ outOfTries: true })

    expect(submitRefusalOf(passedOut, now, courseWithAccess("forbidden"))).toBe("courseForbidden")
    expect(submitRefusalOf(passedOut, now, courseWithAccess("notFound"))).toBe("courseNotFound")
    expect(submitRefusalOf(passedOut, now, courseWithAccess())).toBe("notEnrolled")
    expect(submitRefusalSentence("courseNotFound", "loops")).toBe(
      "This course no longer exists, so loops cannot be submitted.",
    )
  })

  test("names the exercise and its chapter in the sentence", () => {
    expect(submitRefusalSentence("chapterCompletedAndLocked", "loops", "Loops")).toBe(
      'The chapter "Loops" is locked, so loops can no longer be submitted.',
    )
    expect(triesLeftText(1)).toBe("1 try left")
    expect(triesLeftText(2)).toBe("2 tries left")
    expect(triesLeftText(0)).toBe("no tries left")
    expect(triesLeftText(undefined)).toBeUndefined()
  })
})

/** A course whose one closed chapter holds `exercise`. */
const courseClosing = (exercise: LocalCourseExercise): LocalCourseData =>
  makeMoocKind({
    id: "course",
    name: "course",
    title: "Course",
    description: null,
    organization: "org",
    aiPolicy: "not_set" as const,
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    newExercises: [],
    notifyAfter: 0,
    closedChapters: [
      {
        name: "Recursion",
        number: 3,
        opensAt: "2100-01-01T00:00:00Z",
        exercises: exercise.kind === "mooc" ? [exercise.data] : [],
      },
    ],
  })

suite("submitRefusalOf for an exercise of a chapter not open yet", () => {
  const now = new Date("2026-11-13T12:00:00Z")
  test("says the chapter is not open, after the exercise's own lasting reasons", () => {
    const hidden = mooc({ id: "hidden", triesLeft: 2 })
    expect(submitRefusalOf(hidden, now, courseClosing(hidden))).toBe("chapterNotOpenYet")
    const usedUp = mooc({ id: "hidden", triesLeft: 0 })
    expect(submitRefusalOf(usedUp, now, courseClosing(usedUp))).toBe("outOfTries")
  })

  test("orders every refusal once", () => {
    expect(new Set(SUBMIT_REFUSAL_PRIORITY).size).toBe(Object.keys(SUBMIT_REFUSAL_LABELS).length)
  })
})

suite("LocalCourseData.getClosedChapterOf", () => {
  test("finds the closed chapter holding an exercise, and none for a listed one", () => {
    const course = makeMoocKind({
      id: "course",
      name: "course",
      title: "Course",
      description: null,
      organization: "org",
      aiPolicy: "not_set" as const,
      exercises: [],
      availablePoints: 0,
      awardedPoints: 0,
      newExercises: [],
      notifyAfter: 0,
      closedChapters: [
        {
          name: "Recursion",
          number: 3,
          opensAt: "2100-01-01T00:00:00Z",
          exercises: [
            {
              id: "hidden",
              name: "",
              deadline: null,
              passed: false,
              availablePoints: 1,
              awardedPoints: 0,
            },
          ],
        },
      ],
    })
    expect(
      LocalCourseData.getClosedChapterOf(course, makeMoocKind({ moocExerciseId: "hidden" }))?.name,
    ).toBe("Recursion")
    expect(
      LocalCourseData.getClosedChapterOf(course, makeMoocKind({ moocExerciseId: "other" })),
    ).toBeUndefined()
  })
})

suite("SharedMoocCourseExerciseSchema", () => {
  test("drops a review stage or decision it does not know instead of the exercise", () => {
    const parsed = SharedMoocCourseExerciseSchema.safeParse({
      id: "e1",
      name: "Hello",
      deadline: null,
      passed: false,
      awardedPoints: 0,
      availablePoints: 1,
      reviewingStage: "some_future_stage",
      teacherReview: {
        decision: "some_future_decision",
        justification: null,
        scoreGiven: 1,
        createdAt: "2026-11-01T00:00:00Z",
      },
    })

    expect(parsed.success && parsed.data).toMatchObject({ id: "e1" })
    expect(parsed.data?.reviewingStage).toBeUndefined()
    expect(parsed.data?.teacherReview).toBeUndefined()
  })
})
