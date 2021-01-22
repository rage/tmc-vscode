import { expect } from "chai";
import { Err, Ok } from "ts-results";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";

import { moveExtensionDataPath } from "../../actions";
import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { v2_0_0 as userData } from "../fixtures/userData";
import { workspaceExercises } from "../fixtures/workspaceManager";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";

suite("moveExtensionDataPath action", function () {
    const courseName = "test-python-course";
    const newPath = vscode.Uri.file("/new/path");
    const openExercises = workspaceExercises.filter((x) => x.status === ExerciseStatus.Open);
    const openExerciseSlugs = openExercises.map((x) => x.exerciseSlug);
    const stubContext = createMockActionContext();

    let tmcMock: IMock<TMC>;
    let tmcMockValues: TMCMockValues;
    let userDataMock: IMock<UserData>;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerActiveCourse: string | undefined;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        tmc: tmcMock.object,
        userData: userDataMock.object,
        workspaceManager: workspaceManagerMock.object,
    });

    setup(function () {
        [tmcMock, tmcMockValues] = createTMCMock();
        userDataMock = Mock.ofType<UserData>();
        userDataMock.setup((x) => x.getCourses()).returns(() => userData.courses);
        workspaceManagerMock = Mock.ofType<WorkspaceManager>();
        workspaceManagerMock
            .setup((x) => x.activeCourse)
            .returns(() => workspaceManagerActiveCourse);
        workspaceManagerMock
            .setup((x) => x.closeCourseExercises(It.isAny(), It.isAny()))
            .returns(async () => Ok.EMPTY);
        workspaceManagerMock
            .setup((x) => x.getExercisesByCourseSlug(It.isValue(courseName)))
            .returns(() => workspaceExercises);
        workspaceManagerMock.setup((x) => x.setExercises(It.isAny())).returns(async () => Ok.EMPTY);
        workspaceManagerActiveCourse = courseName;
    });

    test("changes extension data path", async function () {
        const result = await moveExtensionDataPath(actionContext(), newPath);
        expect(result).to.be.equal(Ok.EMPTY);
    });

    test("should close current workspace's exercises", async function () {
        await moveExtensionDataPath(actionContext(), newPath);
        workspaceManagerMock.verify(
            (x) => x.closeCourseExercises(It.isValue(courseName), It.isValue(openExerciseSlugs)),
            Times.once(),
        );
    });

    test("should set exercises again after moving", async function () {
        await moveExtensionDataPath(actionContext(), newPath);
        // Due to usage of path.sep, exact matching not consistent between platforms
        workspaceManagerMock.verify((x) => x.setExercises(It.isAny()), Times.once());
    });

    test("should not close anything if no course workspace is active", async function () {
        workspaceManagerActiveCourse = undefined;
        await moveExtensionDataPath(actionContext(), newPath);
        workspaceManagerMock.verify(
            (x) => x.closeCourseExercises(It.isValue(courseName), It.isValue(openExerciseSlugs)),
            Times.never(),
        );
    });

    test("should result in error if TMC operation fails", async function () {
        tmcMockValues.moveProjectsDirectory = Err(new Error());
        const result = await moveExtensionDataPath(actionContext(), newPath);
        expect(result.val).to.be.instanceOf(Error);
    });
});
