import { expect } from "chai";
import { Err, Ok } from "ts-results";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";

import { moveExtensionDataPath } from "../../actions/moveExtensionDataPath";
import { ActionContext, CourseClosedExercises } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { createMockActionContext } from "../__mocks__/actionContext";
import { courseClosedExercises, localPythonCourseExercises } from "../fixtures/tmc";
import { v2_0_0 as userData } from "../fixtures/userData";
import { workspaceExercises } from "../fixtures/workspaceManager";

suite("moveExtensionDataPath action", function () {
    const courseName = "test-python-course";
    const newPath = vscode.Uri.file("/new/path");
    const openExercises = workspaceExercises.filter((x) => x.status === ExerciseStatus.Open);
    const openExerciseSlugs = openExercises.map((x) => x.exerciseSlug);
    const stubContext = createMockActionContext();

    let tmcMock: IMock<TMC>;
    let tmcMoveSuccess: boolean;
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
        tmcMock = Mock.ofType<TMC>();
        tmcMock
            .setup((x) => x.moveProjectsDirectory(It.isAny(), It.isAny()))
            .returns(async () => (tmcMoveSuccess ? Ok.EMPTY : Err(new Error())));
        tmcMock
            .setup((x) =>
                x.getSettingObject<CourseClosedExercises[]>(
                    It.isValue("closed-exercises"),
                    It.isAny(),
                ),
            )
            .returns(async () => Ok(courseClosedExercises));
        tmcMock
            .setup((x) => x.listLocalCourseExercises(It.isAny()))
            .returns(async () => Ok(localPythonCourseExercises));
        tmcMoveSuccess = true;
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
});
