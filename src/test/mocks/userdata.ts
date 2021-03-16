import { IMock, Mock } from "typemoq";

import { LocalCourseData } from "../../api/storage";
import { UserData } from "../../config/userdata";
import { v2_0_0 as userData } from "../fixtures/userData";

export interface UserDataMockValues {
    getCourses: LocalCourseData[];
}

export function createUserDataMock(): [IMock<UserData>, UserDataMockValues] {
    const values: UserDataMockValues = {
        getCourses: userData.courses,
    };
    const mock = setupMockValues(values);

    return [mock, values];
}

function setupMockValues(values: UserDataMockValues): IMock<UserData> {
    const mock = Mock.ofType<UserData>();

    mock.setup((x) => x.getCourses()).returns(() => values.getCourses);

    return mock;
}
