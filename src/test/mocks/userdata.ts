import { IMock, It, Mock } from "typemoq";

import { LocalCourseData, LocalTmcCourseExercise } from "../../api/storage";
import { UserData } from "../../config/userdata";
import { v2_1_0 as userData } from "../fixtures/userData";

export interface UserDataMockValues {
    getCourses: LocalCourseData[];
    getExerciseByName: Readonly<LocalTmcCourseExercise> | undefined;
}

export function createUserDataMock(): [IMock<UserData>, UserDataMockValues] {
    const values: UserDataMockValues = {
        getCourses: userData.courses,
        getExerciseByName: undefined,
    };
    const mock = setupMockValues(values);

    return [mock, values];
}

function setupMockValues(values: UserDataMockValues): IMock<UserData> {
    const mock = Mock.ofType<UserData>();

    mock.setup((x) => x.getCourses()).returns(() => values.getCourses);

    mock.setup((x) => x.getTmcExerciseByName(It.isAny(), It.isAny())).returns(
        () => values.getExerciseByName,
    );

    return mock;
}
