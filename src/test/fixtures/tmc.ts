import type {
  LocalExercise,
  LocalTmcExercise,
  MoocCourse,
  MoocCourseProgress,
  TmcExerciseSlide,
} from "../../shared/langsSchema"
import type { ExerciseIdentifier } from "../../shared/shared"
import { makeTmcKind } from "../../shared/shared"

const tmcExerciseUpdates: ExerciseIdentifier[] = [makeTmcKind({ tmcExerciseId: 2 })]

const moocExerciseUpdates: ExerciseIdentifier[] = []

const closedExercisesPythonCourse: string[] = ["other_world"]

const listLocalCourseExercisesPythonCourse: LocalTmcExercise[] = [
  {
    "course-slug": "test-python-course",
    "exercise-id": 1,
    "exercise-path": "/tmc/vscode/test-python-course/hello_world",
    "exercise-slug": "hello_world",
  },
  {
    "course-slug": "test-python-course",
    "exercise-id": 2,
    "exercise-path": "/tmc/vscode/test-python-course/other_world",
    "exercise-slug": "other_world",
  },
]

const localExercises: LocalExercise[] = listLocalCourseExercisesPythonCourse.map((x) => ({
  backend: "tmc",
  ...x,
}))

// -------------------------------------------------------------------------------------------------
// mooc fixtures (courses.mooc.fi — UUID-keyed)
// -------------------------------------------------------------------------------------------------

const MOOC_COURSE_UUID = "018f6f9b-1c2d-7e3f-8a4b-5c6d7e8f9a0b"
const MOOC_EXERCISE_UUID = "550e8400-e29b-41d4-a716-446655440000"
const MOOC_TASK_UUID = "67e55044-10b1-426f-9247-bb680e5fe0c8"

const moocCourse: MoocCourse = {
  id: MOOC_COURSE_UUID,
  slug: "mooc-python-course",
  name: "Mooc Python",
  description: "A mooc course",
  organization_name: "University of Helsinki",
}

const moocExerciseSlides: TmcExerciseSlide[] = [
  {
    slide_id: MOOC_COURSE_UUID,
    exercise_id: MOOC_EXERCISE_UUID,
    course_id: MOOC_COURSE_UUID,
    exercise_name: "mooc_hello",
    exercise_order_number: 0,
    deadline: null,
    tasks: [
      {
        task_id: MOOC_TASK_UUID,
        order_number: 0,
        public_spec: null,
        model_solution_spec: null,
        checksum: null,
        assignment: null,
      },
    ],
  },
]

const moocEnrolledCourses: MoocCourse[] = [moocCourse]

// The user's progress for `moocCourse`: the one exercise passed with full points.
const moocCourseProgress: MoocCourseProgress = {
  course_id: MOOC_COURSE_UUID,
  exercises: [
    {
      exercise_id: MOOC_EXERCISE_UUID,
      score_given: 1,
      score_maximum: 1,
      completed: true,
      attempted: true,
    },
  ],
}

export {
  closedExercisesPythonCourse,
  listLocalCourseExercisesPythonCourse,
  localExercises,
  MOOC_COURSE_UUID,
  MOOC_EXERCISE_UUID,
  MOOC_TASK_UUID,
  moocCourse,
  moocCourseProgress,
  moocEnrolledCourses,
  moocExerciseSlides,
  moocExerciseUpdates,
  tmcExerciseUpdates,
}
