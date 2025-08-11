import { expect } from "chai";
import * as path from "path";
import { Err, Ok } from "ts-results";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

import { moveExtensionDataPath } from "../../actions";
import { ActionContext } from "../../actions/types";
import Langs from "../../api/langs";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { workspaceExercises } from "../fixtures/workspaceManager";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";
import { createUserDataMock } from "../mocks/userdata";
import { createWorkspaceMangerMock, WorkspaceManagerMockValues } from "../mocks/workspaceManager";
import { makeTmpDirs } from "../utils";

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
    const emptyFolder = (root: string): vscode.Uri => vscode.Uri.file(root + "/new/path/empty");
    const nonEmptyFolder = (root: string): vscode.Uri =>
        vscode.Uri.file(root + "/new/path/nonempty");
    const openExercises = workspaceExercises.filter((x) => x.status === ExerciseStatus.Open);
    const openExerciseSlugs = openExercises.map((x) => x.exerciseSlug);
    const stubContext = createMockActionContext();
    let root: string;

    let tmcMock: IMock<Langs>;
    let tmcMockValues: TMCMockValues;
    let userDataMock: IMock<UserData>;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerMockValues: WorkspaceManagerMockValues;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        langs: new Ok(tmcMock.object),
        userData: new Ok(userDataMock.object),
        workspaceManager: new Ok(workspaceManagerMock.object),
    });

    setup(function () {
        root = makeTmpDirs(virtualFileSystem);
        [tmcMock, tmcMockValues] = createTMCMock();
        [userDataMock] = createUserDataMock();
        [workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock();
        workspaceManagerMockValues.activeCourse = courseName;
    });

    test("should change extension data path", async function () {
        const result = await moveExtensionDataPath(actionContext(), emptyFolder(root));
        expect(result).to.be.equal(Ok.EMPTY);
        tmcMock.verify(
            (x) => x.moveProjectsDirectory(It.isValue(emptyFolder(root).fsPath), It.isAny()),
            Times.once(),
        );
    });

    test("should append tmcdata to path if target is not empty", async function () {
        const result = await moveExtensionDataPath(actionContext(), nonEmptyFolder(root));
        expect(result).to.be.equal(Ok.EMPTY);
        const expected = path.join(nonEmptyFolder(root).fsPath, "tmcdata");
        tmcMock.verify(
            (x) => x.moveProjectsDirectory(It.isValue(expected), It.isAny()),
            Times.once(),
        );
    });

    test.skip("should close current workspace's exercises", async function () {
        await moveExtensionDataPath(actionContext(), emptyFolder(root));
        workspaceManagerMock.verify(
            (x) =>
                x.closeCourseExercises(
                    "tmc",
                    It.isValue(courseName),
                    It.isValue(openExerciseSlugs),
                ),
            Times.once(),
        );
    });

    test("should set exercises again after moving", async function () {
        await moveExtensionDataPath(actionContext(), emptyFolder(root));
        // Due to usage of path.sep, exact matching not consistent between platforms
        workspaceManagerMock.verify((x) => x.setExercises(It.isAny()), Times.once());
    });

    test.skip("should not close anything if no course workspace is active", async function () {
        workspaceManagerMockValues.activeCourse = undefined;
        await moveExtensionDataPath(actionContext(), emptyFolder(root));
        workspaceManagerMock.verify(
            (x) =>
                x.closeCourseExercises(
                    "tmc",
                    It.isValue(courseName),
                    It.isValue(openExerciseSlugs),
                ),
            Times.never(),
        );
    });

    test("should result in error if TMC operation fails", async function () {
        tmcMockValues.moveProjectsDirectory = Err(new Error());
        const result = await moveExtensionDataPath(actionContext(), emptyFolder(root));
        expect(result.val).to.be.instanceOf(Error);
    });
});
