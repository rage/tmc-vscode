import { Ok, Result } from "ts-results";
import { IMock, It, Mock } from "typemoq";

import { CourseClosedExercises } from "../../actions/types";
import { LocalExercise } from "../../api/langsSchema";
import TMC from "../../api/tmc";
import {
    checkExerciseUpdates,
    courseClosedExercises,
    listLocalCourseExercisesPythonCourse,
} from "../fixtures/tmc";

export interface TMCMockValues {
    checkExerciseUpdates: Result<Array<{ id: number }>, Error>;
    clean: Result<void, Error>;
    getSettingObjectClosedExercises: Result<CourseClosedExercises[], Error>;
    moveProjectsDirectory: Result<void, Error>;
    listLocalCourseExercisesPythonCourse: Result<LocalExercise[], Error>;
}

export function createTMCMock(): [IMock<TMC>, TMCMockValues] {
    const mock = Mock.ofType<TMC>();
    const values: TMCMockValues = {
        checkExerciseUpdates: Ok(checkExerciseUpdates),
        clean: Ok.EMPTY,
        getSettingObjectClosedExercises: Ok(courseClosedExercises),
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
        x.getSettingObject<CourseClosedExercises[]>(It.isValue("closed-exercises"), It.isAny()),
    ).returns(async () => values.getSettingObjectClosedExercises);

    mock.setup((x) =>
        x.listLocalCourseExercises(It.isValue("test-python-course")),
    ).returns(async () => Ok(listLocalCourseExercisesPythonCourse));

    return [mock, values];
}
