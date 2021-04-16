import { expect } from "chai";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

import ExerciseDecorationProvider from "../../api/exerciseDecorationProvider";
import WorkspaceManager from "../../api/workspaceManager";
import { UserData } from "../../config/userdata";
import { userDataExerciseHelloWorld } from "../fixtures/userData";
import { exerciseHelloWorld } from "../fixtures/workspaceManager";
import { createUserDataMock, UserDataMockValues } from "../mocks/userdata";
import { createWorkspaceMangerMock, WorkspaceManagerMockValues } from "../mocks/workspaceManager";

suite("ExerciseDecoratorProvider class", function () {
    let userDataMock: IMock<UserData>;
    let userDataMockValues: UserDataMockValues;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerMockValues: WorkspaceManagerMockValues;

    let exerciseDecorationProvider: ExerciseDecorationProvider;

    setup(function () {
        [userDataMock, userDataMockValues] = createUserDataMock();
        userDataMockValues.getExerciseByName = userDataExerciseHelloWorld;

        [workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock();
        workspaceManagerMockValues.getExerciseByPath = exerciseHelloWorld;

        exerciseDecorationProvider = new ExerciseDecorationProvider(
            userDataMock.object,
            workspaceManagerMock.object,
        );
    });

    test("should decorate passed exercise with a checkmark", function () {
        userDataMockValues.getExerciseByName = { ...userDataExerciseHelloWorld, passed: true };
        const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri);
        expect((decoration as vscode.FileDecoration).badge).to.be.equal("✓");
    });

    test("should decorate expired exercise with an X mark", function () {
        const expiredExercise = { ...userDataExerciseHelloWorld, deadline: "1970-01-01" };
        userDataMockValues.getExerciseByName = expiredExercise;
        const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri);
        expect((decoration as vscode.FileDecoration).badge).to.be.equal("✗");
    });

    test("should decorate exercise missing from UserData with information symbol", function () {
        userDataMockValues.getExerciseByName = undefined;
        const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri);
        expect((decoration as vscode.FileDecoration).badge).to.be.equal("ⓘ");
    });

    test("should not decorate valid exercise that isn't yet passed", function () {
        userDataMockValues.getExerciseByName = { ...userDataExerciseHelloWorld, passed: false };
        const decoration = exerciseDecorationProvider.provideFileDecoration(exerciseHelloWorld.uri);
        expect(decoration).to.be.undefined;
    });

    test("should not decorate exercise folder subitem", function () {
        const rootUri = vscode.Uri.file("/tmc/vscode/test-python-course/hello_world");
        const subUri = vscode.Uri.file("/tmc/vscode/test-python-course/hello_world/src/hello.py");
        workspaceManagerMockValues.getExerciseByPath = { ...exerciseHelloWorld, uri: rootUri };
        const decoration = exerciseDecorationProvider.provideFileDecoration(subUri);
        expect(decoration).to.be.undefined;
    });

    test("should not attempt to decorate a non-exercise", function () {
        const notExercise = vscode.Uri.file("something.txt");
        const decoration = exerciseDecorationProvider.provideFileDecoration(notExercise);
        expect(decoration).to.be.undefined;
        userDataMock.verify((x) => x.getExerciseByName(It.isAny(), It.isAny()), Times.never());
    });
});
