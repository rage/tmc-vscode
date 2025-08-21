import { expect } from "chai";
import { Err, Ok } from "ts-results";
import { IMock, It, Times } from "typemoq";

import { refreshLocalExercises } from "../../actions/refreshLocalExercises";
import { ActionContext } from "../../actions/types";
import Langs from "../../api/langs";
import WorkspaceManager from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";
import { createUserDataMock, UserDataMockValues } from "../mocks/userdata";
import { createWorkspaceMangerMock, WorkspaceManagerMockValues } from "../mocks/workspaceManager";

suite("refreshLocalExercises action", function () {
    const stubContext = createMockActionContext();

    let tmcMock: IMock<Langs>;
    let tmcMockValues: TMCMockValues;
    let userDataMock: IMock<UserData>;
    let userDataMockValues: UserDataMockValues;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerMockValues: WorkspaceManagerMockValues;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        langs: new Ok(tmcMock.object),
        userData: new Ok(userDataMock.object),
        workspaceManager: new Ok(workspaceManagerMock.object),
    });

    setup(function () {
        [tmcMock, tmcMockValues] = createTMCMock();
        [userDataMock, userDataMockValues] = createUserDataMock();
        [workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock();
    });

    test("should set exercises to WorkspaceManager", async function () {
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
        workspaceManagerMock.verify((x) => x.setExercises(It.isAny()), Times.once());
    });

    test("should work without any courses", async function () {
        userDataMockValues.getCourses = [];
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
    });

    test("should tolerate Langs errors", async function () {
        tmcMockValues.getSettingClosedExercises = Err(new Error());
        tmcMockValues.listLocalCourseExercisesPythonCourse = Err(new Error());
        const result = await refreshLocalExercises(actionContext());
        expect(result).to.be.equal(Ok.EMPTY);
    });

    test("should return error if WorkspaceManager operation fails", async function () {
        workspaceManagerMockValues.setExercises = Err(new Error());
        const result = await refreshLocalExercises(actionContext());
        expect(result.val).to.be.instanceOf(Error);
    });
});
