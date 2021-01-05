import * as path from "path";
import { Ok } from "ts-results";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";

import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { cleanExercise } from "../../commands";
import { createMockActionContext } from "../__mocks__/actionContext";

suite("Clean exercise command", function () {
    const BACKEND_FOLDER = path.join(__dirname, "..", "backend");
    const COURSE_PATH = path.join(BACKEND_FOLDER, "resources", "test-python-course");
    const PASSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-01_passing_exercise");

    const stubContext = createMockActionContext();
    const uri = vscode.Uri.file(PASSING_EXERCISE_PATH);

    let tmcMock: IMock<TMC>;
    let workspaceManagerMock: IMock<WorkspaceManager>;

    function actionContext(): ActionContext {
        return {
            ...stubContext,
            tmc: tmcMock.object,
            workspaceManager: workspaceManagerMock.object,
        };
    }

    setup(function () {
        tmcMock = Mock.ofType<TMC>();
        workspaceManagerMock = Mock.ofType<WorkspaceManager>();
    });

    test("should clean active exercise by default", async function () {
        workspaceManagerMock.setup((x) => x.uriIsExercise(It.isAny())).returns(() => true);
        workspaceManagerMock
            .setup((x) => x.activeExercise)
            .returns(() => ({
                courseSlug: "test-python-course",
                exerciseSlug: "part01-01_passing_exercise",
                status: ExerciseStatus.Open,
                uri,
            }));
        tmcMock.setup((x) => x.clean(It.isAnyString())).returns(() => Promise.resolve(Ok.EMPTY));
        await cleanExercise(actionContext(), undefined);
        tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once());
    });

    test("should not clean active non-exercise", async function () {
        workspaceManagerMock.setup((x) => x.activeExercise).returns(() => undefined);
        await cleanExercise(actionContext(), undefined);
        tmcMock.verify((x) => x.clean(It.isAny()), Times.never());
    });

    test("should clean provided exercise", async function () {
        workspaceManagerMock.setup((x) => x.uriIsExercise(It.isAny())).returns(() => true);
        tmcMock.setup((x) => x.clean(It.isAnyString())).returns(() => Promise.resolve(Ok.EMPTY));
        await cleanExercise(actionContext(), uri);
        tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once());
    });

    test("should not clean provided non-exercise", async function () {
        workspaceManagerMock.setup((x) => x.uriIsExercise(It.isAny())).returns(() => false);
        await cleanExercise(actionContext(), uri);
        tmcMock.verify((x) => x.clean(It.isAny()), Times.never());
    });
});
