import type { CourseInstance, LocalTmcExercise, TmcExerciseSlide } from "../../shared/langsSchema"

const checkExerciseUpdates: { id: number }[] = [{ id: 2 }]

// mooc updated-exercise ids are exercise (task) uuids
const checkMoocExerciseUpdates: string[] = []

const closedExercisesPythonCourse: string[] = ["other_world"]

const listLocalCourseExercisesPythonCourse: LocalTmcExercise[] = [
  {
    "exercise-path": "/tmc/vscode/test-python-course/hello_world",
    "exercise-slug": "hello_world",
  },
  {
    "exercise-path": "/tmc/vscode/test-python-course/other_world",
    "exercise-slug": "other_world",
  },
]

// -------------------------------------------------------------------------------------------------
// mooc fixtures (courses.mooc.fi — UUID-keyed)
// -------------------------------------------------------------------------------------------------

const MOOC_INSTANCE_UUID = "018f6f9b-1c2d-7e3f-8a4b-5c6d7e8f9a0b"
const MOOC_EXERCISE_UUID = "550e8400-e29b-41d4-a716-446655440000"
const MOOC_TASK_UUID = "67e55044-10b1-426f-9247-bb680e5fe0c8"

const moocCourseInstance: CourseInstance = {
  id: MOOC_INSTANCE_UUID,
  slug: "mooc-python-course",
  name: "Mooc Python",
  description: "A mooc course",
  organization_name: "University of Helsinki",
}

const moocExerciseSlides: TmcExerciseSlide[] = [
  {
    slide_id: MOOC_INSTANCE_UUID,
    exercise_id: MOOC_EXERCISE_UUID,
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
      },
    ],
  },
]

const moocEnrolledCourseInstances: CourseInstance[] = [moocCourseInstance]

export {
  checkExerciseUpdates,
  checkMoocExerciseUpdates,
  closedExercisesPythonCourse,
  listLocalCourseExercisesPythonCourse,
  MOOC_EXERCISE_UUID,
  MOOC_INSTANCE_UUID,
  MOOC_TASK_UUID,
  moocCourseInstance,
  moocEnrolledCourseInstances,
  moocExerciseSlides,
}
