import { expect } from "chai";
import { Err, Ok } from "ts-results";
import { IMock, It, Mock, Times } from "typemoq";

import { refreshLocalExercises } from "../../actions/refreshLocalExercises";
import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { createMockActionContext } from "../__mocks__/actionContext";
import { localPythonCourseExercises } from "../fixtures/tmc";
import { v2_0_0 as userData } from "../fixtures/userData";

suite("refreshLocalExercises action", function () {
    const stubContext = createMockActionContext();

    let tmcMock: IMock<TMC>;
    let userDataMock: IMock<UserData>;
    let workspaceManagerMock: IMock<WorkspaceManager>;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        tmc: tmcMock.object,
        userData: userDataMock.object,
        workspaceManager: workspaceManagerMock.object,
    });

    setup(function () {
        tmcMock = Mock.ofType<TMC>();
        tmcMock
            .setup((x) => x.getSettingObject(It.isValue("closed-exercises"), It.isAny()))
            .returns(async () => Ok([]));
        tmcMock
            .setup((x) => x.listLocalCourseExercises(It.isAny()))
            .returns(async () => Ok(localPythonCourseExercises));
        userDataMock = Mock.ofType<UserData>();
        userDataMock.setup((x) => x.getCourses()).returns(() => userData.courses);
        workspaceManagerMock = Mock.ofType<WorkspaceManager>();
        workspaceManagerMock.setup((x) => x.setExercises(It.isAny())).returns(async () => Ok.EMPTY);
    });

    test("should set exercises to WorkspaceManager", async function () {
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
        workspaceManagerMock.verify((x) => x.setExercises(It.isAny()), Times.once());
    });

    test("should work without any courses", async function () {
        userDataMock.reset();
        userDataMock.setup((x) => x.getCourses()).returns(() => []);
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
    });

    test("should tolerate Langs errors", async function () {
        tmcMock.reset();
        tmcMock
            .setup((x) => x.getSettingObject(It.isValue("closed-exercises"), It.isAny()))
            .returns(async () => Err(new Error()));
        tmcMock
            .setup((x) => x.listLocalCourseExercises(It.isAny()))
            .returns(async () => Err(new Error()));
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
    });

    test("should return error if WorkspaceManager operation fails", async function () {
        workspaceManagerMock.reset();
        workspaceManagerMock
            .setup((x) => x.setExercises(It.isAny()))
            .returns(async () => Err(new Error()));
        const result = await refreshLocalExercises(actionContext());
        expect(result.val).to.be.instanceOf(Error);
    });
});
