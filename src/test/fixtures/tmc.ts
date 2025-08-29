import { LocalTmcExercise } from "../../shared/langsSchema";

const checkExerciseUpdates: Array<{ id: number }> = [{ id: 2 }];

const closedExercisesPythonCourse: string[] = ["other_world"];

const listLocalCourseExercisesPythonCourse: LocalTmcExercise[] = [
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
