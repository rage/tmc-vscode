import { expect } from "chai";
import * as mockFs from "mock-fs";
import * as path from "path";
import { Err, Ok } from "ts-results";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

import { moveExtensionDataPath } from "../../actions";
import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { workspaceExercises } from "../fixtures/workspaceManager";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";
import { createUserDataMock } from "../mocks/userdata";
import { createWorkspaceMangerMock, WorkspaceManagerMockValues } from "../mocks/workspaceManager";

suite("moveExtensionDataPath action", function () {
    const virtualFileSystem = {
        "/new/path/": {
            empty: {},
            nonempty: {
                "file.txt": "",
            },
        },
    };

    const courseName = "test-python-course";
    const emptyFolder = vscode.Uri.file("/new/path/empty");
    const nonEmptyFolder = vscode.Uri.file("/new/path/nonempty");
    const openExercises = workspaceExercises.filter((x) => x.status === ExerciseStatus.Open);
    const openExerciseSlugs = openExercises.map((x) => x.exerciseSlug);
    const stubContext = createMockActionContext();

    let tmcMock: IMock<TMC>;
    let tmcMockValues: TMCMockValues;
    let userDataMock: IMock<UserData>;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerMockValues: WorkspaceManagerMockValues;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        tmc: tmcMock.object,
        userData: userDataMock.object,
        workspaceManager: workspaceManagerMock.object,
    });

    setup(function () {
        mockFs(virtualFileSystem);
        [tmcMock, tmcMockValues] = createTMCMock();
        [userDataMock] = createUserDataMock();
        [workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock();
        workspaceManagerMockValues.activeCourse = courseName;
    });

    test("should change extension data path", async function () {
        const result = await moveExtensionDataPath(actionContext(), emptyFolder);
        expect(result).to.be.equal(Ok.EMPTY);
        tmcMock.verify(
            (x) => x.moveProjectsDirectory(It.isValue(emptyFolder.fsPath), It.isAny()),
            Times.once(),
        );
    });

    test("should append tmcdata to path if target is not empty", async function () {
        const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder);
        expect(result).to.be.equal(Ok.EMPTY);
        const expected = path.join(nonEmptyFolder.fsPath, "tmcdata");
        tmcMock.verify(
            (x) => x.moveProjectsDirectory(It.isValue(expected), It.isAny()),
            Times.once(),
        );
    });

    test.skip("should close current workspace's exercises", async function () {
        await moveExtensionDataPath(actionContext(), emptyFolder);
        workspaceManagerMock.verify(
            (x) => x.closeCourseExercises(It.isValue(courseName), It.isValue(openExerciseSlugs)),
            Times.once(),
        );
    });

    test("should set exercises again after moving", async function () {
        await moveExtensionDataPath(actionContext(), emptyFolder);
        // Due to usage of path.sep, exact matching not consistent between platforms
        workspaceManagerMock.verify((x) => x.setExercises(It.isAny()), Times.once());
    });

    test.skip("should not close anything if no course workspace is active", async function () {
        workspaceManagerMockValues.activeCourse = undefined;
        await moveExtensionDataPath(actionContext(), emptyFolder);
        workspaceManagerMock.verify(
            (x) => x.closeCourseExercises(It.isValue(courseName), It.isValue(openExerciseSlugs)),
            Times.never(),
        );
    });

    test("should result in error if TMC operation fails", async function () {
        tmcMockValues.moveProjectsDirectory = Err(new Error());
        const result = await moveExtensionDataPath(actionContext(), emptyFolder);
        expect(result.val).to.be.instanceOf(Error);
    });

    teardown(function () {
        mockFs.restore();
    });
});
