import { Ok, Result } from "ts-results";
import { IMock, It, Mock } from "typemoq";

import { LocalExercise } from "../../api/langsSchema";
import TMC from "../../api/tmc";
import {
    checkExerciseUpdates,
    closedExercisesPythonCourse,
    listLocalCourseExercisesPythonCourse,
} from "../fixtures/tmc";

export interface TMCMockValues {
    checkExerciseUpdates: Result<Array<{ id: number }>, Error>;
    clean: Result<void, Error>;
    getSettingClosedExercises: Result<string[], Error>;
    moveProjectsDirectory: Result<void, Error>;
    listLocalCourseExercisesPythonCourse: Result<LocalExercise[], Error>;
}

export function createTMCMock(): [IMock<TMC>, TMCMockValues] {
    const mock = Mock.ofType<TMC>();
    const values: TMCMockValues = {
        checkExerciseUpdates: Ok(checkExerciseUpdates),
        clean: Ok.EMPTY,
        getSettingClosedExercises: Ok(closedExercisesPythonCourse),
        moveProjectsDirectory: Ok.EMPTY,
        listLocalCourseExercisesPythonCourse: Ok(listLocalCourseExercisesPythonCourse),
    };

    mock.setup((x) => x.checkExerciseUpdates(It.isAny())).returns(
        async () => values.checkExerciseUpdates,
    );

    mock.setup((x) => x.clean(It.isAny())).returns(async () => values.clean);

    mock.setup((x) => x.moveProjectsDirectory(It.isAny(), It.isAny())).returns(
        async () => values.moveProjectsDirectory,
    );

    mock.setup((x) =>
        x.getSetting<string[]>(It.isValue("closed-exercises-for:test-python-course"), It.isAny()),
    ).returns(async () => values.getSettingClosedExercises);

    mock.setup((x) =>
        x.listLocalCourseExercises(It.isValue("test-python-course")),
    ).returns(async () => Ok(listLocalCourseExercisesPythonCourse));

    return [mock, values];
}
