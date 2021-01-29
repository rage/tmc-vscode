import { LocalExercise } from "../../api/langsSchema";

const checkExerciseUpdates: Array<{ id: number }> = [{ id: 2 }];

const closedExercisesPythonCourse: string[] = ["other_world"];

const listLocalCourseExercisesPythonCourse: LocalExercise[] = [
    {
        "exercise-path": "/tmc/vscode/test-python-course/hello_world",
        "exercise-slug": "hello_world",
    },
    {
        "exercise-path": "/tmc/vscode/test-python-course/other_world",
        "exercise-slug": "other_world",
    },
];

export { checkExerciseUpdates, closedExercisesPythonCourse, listLocalCourseExercisesPythonCourse };
