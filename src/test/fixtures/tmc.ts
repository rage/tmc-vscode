import { LocalExercise } from "../../api/langsSchema";

const checkExerciseUpdatesResult: Array<{ id: number }> = [{ id: 2 }];

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

export { checkExerciseUpdatesResult, localPythonCourseExercises };
