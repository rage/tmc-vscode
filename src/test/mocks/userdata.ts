import { IMock, It, Mock } from "typemoq";

import { UserData } from "../../config/userdata";
import { v2_1_0 as userData } from "../fixtures/userData";
import { LocalCourseData, makeTmcKind } from "../../shared/shared";
import { TmcLocalCourseExercise } from "../../storage/data";

export interface UserDataMockValues {
    getCourses: LocalCourseData[];
    getExerciseByName: Readonly<TmcLocalCourseExercise> | undefined;
}

export function createUserDataMock(): [IMock<UserData>, UserDataMockValues] {
    const values: UserDataMockValues = {
        getCourses: userData.courses.map(makeTmcKind),
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
