import type { LocalCourseExercise, SharedMoocCourseExercise } from "../../../shared/lib"
import {
  isSoftDeadlineBinding,
  LocalCourseData,
  makeMoocKind,
  makeTmcKind,
  moocCourseUrlOf,
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

  test("refuses a locked chapter first", () => {
    const chapter = { name: "Loops", number: 2 }
    expect(
      submitRefusalOf(
        mooc({ chapter: { ...chapter, lockingStatus: "NotUnlockedYet" }, triesLeft: 0 }),
        now,
      ),
    ).toBe("chapterNotUnlockedYet")
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
      "loops is locked for you, so it can no longer be submitted. Only a teacher can unlock it.",
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

  test("names the exercise and its chapter in the sentence", () => {
    expect(submitRefusalSentence("chapterCompletedAndLocked", "loops", "Loops")).toBe(
      'You have completed and locked the chapter "Loops", so loops can no longer be submitted.',
    )
    expect(triesLeftText(1)).toBe("1 try left")
    expect(triesLeftText(2)).toBe("2 tries left")
    expect(triesLeftText(0)).toBe("no tries left")
    expect(triesLeftText(undefined)).toBeUndefined()
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
