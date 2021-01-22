import { CourseClosedExercises } from "../../actions/types";
import { LocalExercise } from "../../api/langsSchema";

const checkExerciseUpdatesResult: Array<{ id: number }> = [{ id: 2 }];

const courseClosedExercises: CourseClosedExercises[] = [
    {
        "course-slug": "test-python-course",
        exercises: ["other_world"],
    },
];

const localPythonCourseExercises: LocalExercise[] = [
    {
        "exercise-path": "/tmc/vscode/test-python-course/hello_world",
        "exercise-slug": "hello_world",
    },
    {
        "exercise-path": "/tmc/vscode/test-python-course/other_world",
        "exercise-slug": "other_world",
    },
];

export { checkExerciseUpdatesResult, courseClosedExercises, localPythonCourseExercises };
