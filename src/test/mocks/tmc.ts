import { Err, Ok, Result } from "ts-results";
import { IMock, It, Mock } from "typemoq";

import Langs from "../../api/langs";
import {
    DownloadOrUpdateMoocCourseExercisesResult,
    DownloadOrUpdateTmcCourseExercisesResult,
    LocalExercise,
    LocalTmcExercise,
} from "../../shared/langsSchema";
import {
    checkExerciseUpdates,
    closedExercisesPythonCourse,
    listLocalCourseExercisesPythonCourse,
} from "../fixtures/tmc";

const NOT_MOCKED_ERROR = Err(new Error("Method was not mocked."));

export interface TMCMockValues {
    clean: Result<void, Error>;
    downloadExercises: Result<
        [DownloadOrUpdateTmcCourseExercisesResult, DownloadOrUpdateMoocCourseExercisesResult],
        Error
    >;
    listLocalCourseExercisesPythonCourse: Result<LocalTmcExercise[], Error>;
    getSettingClosedExercises: Result<string[], Error>;
    getSettingProjectsDir: Result<string, Error>;
    migrateExercise: Result<void, Error>;
    moveProjectsDirectory: Result<void, Error>;
    setSettingClosedExercises: Result<void, Error>;
    checkExerciseUpdates: Result<Array<{ id: number }>, Error>;
}

export function createTMCMock(): [IMock<Langs>, TMCMockValues] {
    const values: TMCMockValues = {
        clean: Ok.EMPTY,
        downloadExercises: NOT_MOCKED_ERROR,
        listLocalCourseExercisesPythonCourse: Ok(listLocalCourseExercisesPythonCourse),
        getSettingClosedExercises: Ok(closedExercisesPythonCourse),
        getSettingProjectsDir: Ok("/langs/path/to/exercises"),
        migrateExercise: Ok.EMPTY,
        moveProjectsDirectory: Ok.EMPTY,
        setSettingClosedExercises: Ok.EMPTY,
        checkExerciseUpdates: Ok(checkExerciseUpdates),
    };
    const mock = setupMockValues(values);

    return [mock, values];
}

export function createFailingTMCMock(): [IMock<Langs>, TMCMockValues] {
    const error = Err(new Error());
    const values: TMCMockValues = {
        clean: error,
        downloadExercises: NOT_MOCKED_ERROR,
        listLocalCourseExercisesPythonCourse: error,
        getSettingClosedExercises: error,
        getSettingProjectsDir: error,
        migrateExercise: error,
        moveProjectsDirectory: error,
        setSettingClosedExercises: error,
        checkExerciseUpdates: error,
    };
    const mock = setupMockValues(values);

    return [mock, values];
}

function setupMockValues(values: TMCMockValues): IMock<Langs> {
    const mock = Mock.ofType<Langs>();

    // ---------------------------------------------------------------------------------------------
    // Authentication commands
    // ---------------------------------------------------------------------------------------------

    // ---------------------------------------------------------------------------------------------
    // Non-core commands
    // ---------------------------------------------------------------------------------------------

    mock.setup((x) => x.clean(It.isAny())).returns(async () => values.clean);

    mock.setup((x) => x.listLocalCourseExercises("tmc", It.isValue("test-python-course"))).returns(
        async () => values.listLocalCourseExercisesPythonCourse,
    );

    // ---------------------------------------------------------------------------------------------
    // Settings commands
    // ---------------------------------------------------------------------------------------------

    mock.setup((x) =>
        x.getSetting<string[]>(It.isValue("closed-exercises-for:test-python-course"), It.isAny()),
    ).returns(async () => values.getSettingClosedExercises);

    mock.setup((x) =>
        x.migrateExercise(It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny()),
    ).returns(async () => values.migrateExercise);

    mock.setup((x) => x.moveProjectsDirectory(It.isAny(), It.isAny())).returns(
        async () => values.moveProjectsDirectory,
    );

    mock.setup((x) =>
        x.setSetting(It.isValue("closed-exercises-for:test-python-course"), It.isAny()),
    ).returns(async () => values.setSettingClosedExercises);

    // ---------------------------------------------------------------------------------------------
    // Core commands
    // ---------------------------------------------------------------------------------------------

    mock.setup((x) => x.checkTmcExerciseUpdates(It.isAny())).returns(
        async () => values.checkExerciseUpdates,
    );

    mock.setup((x) => x.downloadExercises(It.isAny(), It.isAny(), It.isAny())).returns(
        async () => values.downloadExercises,
    );

    return mock;
}
