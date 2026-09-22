import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants"
import type { CourseExercise, Exercise } from "../../shared/langsSchema"
import {
  combineTmcApiExerciseData,
  sumCoursePoints,
  sumTmcApiCoursePoints,
} from "../../utilities/apiData"

/** An exercise as `/api/v8/core/courses/{id}` lists it; only the combined fields vary. */
function apiExercise(exercise: Pick<Exercise, "id" | "name" | "completed">): Exercise {
  return {
    all_review_points_given: false,
    attempted: true,
    checksum: "abc123",
    code_review_requests_enabled: false,
    deadline: "2026-01-01T00:00:00.000+02:00",
    deadline_description: null,
    latest_submission_id: null,
    latest_submission_url: null,
    locked: false,
    memory_limit: null,
    requires_review: false,
    return_url: "https://tmc.mooc.fi/return",
    returnable: true,
    reviewed: false,
    run_tests_locally_action_enabled: true,
    runtime_params: [],
    soft_deadline: "2025-12-01T00:00:00.000+02:00",
    soft_deadline_description: null,
    solution_zip_url: null,
    valgrind_strategy: null,
    zip_url: "https://tmc.mooc.fi/zip",
    ...exercise,
  }
}

/** The same exercise as `/api/v8/courses/{id}/exercises` lists it, which is where the points live. */
function pointsForExercise(id: number, available: number, awarded: number): CourseExercise {
  return {
    available_points: Array.from({ length: available }, (_, index) => ({
      exercise_id: id,
      id: id * 100 + index,
      name: `p${index}`,
      requires_review: false,
    })),
    awarded_points: Array.from({ length: awarded }, (_, index) => `p${index}`),
    deadline: null,
    disabled: false,
    id,
    name: `exercise${id}`,
    publish_time: null,
    soft_deadline: null,
    solution_visible_after: null,
    unlocked: true,
  }
}

suite("combineTmcApiExerciseData", function () {
  test("takes points from the matching points-endpoint entry", function () {
    const combined = combineTmcApiExerciseData(
      [apiExercise({ id: 7, name: "week1-01", completed: true })],
      [pointsForExercise(7, 3, 2)],
    )

    expect(combined).toEqual([
      {
        id: 7,
        name: "week1-01",
        availablePoints: 3,
        awardedPoints: 2,
        passed: true,
        deadline: "2026-01-01T00:00:00.000+02:00",
        softDeadline: "2025-12-01T00:00:00.000+02:00",
      },
    ])
  })

  test("falls back to placeholder points for an exercise the points endpoint omits", function () {
    // The two endpoints can disagree, and the tree still has to show the exercise
    // as passed or not; the placeholders keep that single-point scale.
    const [passed, unpassed] = combineTmcApiExerciseData(
      [
        apiExercise({ id: 1, name: "solved", completed: true }),
        apiExercise({ id: 2, name: "unsolved", completed: false }),
      ],
      [],
    )

    expect(passed?.availablePoints).toBe(LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER)
    expect(passed?.awardedPoints).toBe(LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER)
    expect(unpassed?.availablePoints).toBe(LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER)
    expect(unpassed?.awardedPoints).toBe(LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER)
  })

  test("keeps a listed zero awarded points rather than falling back", function () {
    // A completed exercise whose points entry awards nothing: the entry is the
    // truth, and the placeholder would credit it a point it has not earned.
    const [combined] = combineTmcApiExerciseData(
      [apiExercise({ id: 3, name: "reviewed", completed: true })],
      [pointsForExercise(3, 2, 0)],
    )

    expect(combined?.awardedPoints).toBe(0)
  })

  test("yields one exercise per listed exercise, ignoring points for exercises not listed", function () {
    const combined = combineTmcApiExerciseData(
      [apiExercise({ id: 4, name: "week1-01", completed: false })],
      [pointsForExercise(4, 1, 1), pointsForExercise(99, 5, 5)],
    )

    expect(combined.map((exercise) => exercise.id)).toEqual([4])
  })
})

suite("sumTmcApiCoursePoints", function () {
  test("sums the points endpoint's own totals, free of the placeholder fallback", function () {
    const courseExercises = [pointsForExercise(1, 3, 1), pointsForExercise(2, 2, 2)]
    const combined = combineTmcApiExerciseData(
      [
        apiExercise({ id: 1, name: "a", completed: false }),
        apiExercise({ id: 2, name: "b", completed: true }),
        apiExercise({ id: 3, name: "not-in-points", completed: true }),
      ],
      courseExercises,
    )

    expect(sumTmcApiCoursePoints(courseExercises)).toEqual({
      availablePoints: 5,
      awardedPoints: 3,
    })
    // Summing the combined exercises instead would count the omitted one's placeholders.
    expect(sumCoursePoints(combined)).toEqual({ availablePoints: 6, awardedPoints: 4 })
  })

  test("is zero for a course with no exercises", function () {
    expect(sumTmcApiCoursePoints([])).toEqual({ availablePoints: 0, awardedPoints: 0 })
  })
})
