import { IMock, It, Mock } from "typemoq";

import { v2 } from "../../storage/data";
import { UserData } from "../../config/userdata";
import { v2_1_0 as userData } from "../fixtures/userData";

export interface UserDataMockValues {
    getCourses: v2.LocalCourseData[];
    getExerciseByName: Readonly<v2.LocalCourseExercise> | undefined;
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

    mock.setup((x) => x.getExerciseByName(It.isAny(), It.isAny())).returns(
        () => values.getExerciseByName,
    );

    return mock;
}
