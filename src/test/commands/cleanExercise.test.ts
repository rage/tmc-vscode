import * as path from "path";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager";
import { cleanExercise } from "../../commands";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock } from "../mocks/tmc";
import { createWorkspaceMangerMock, WorkspaceManagerMockValues } from "../mocks/workspaceManager";
import { Ok } from "ts-results";

suite("Clean exercise command", function () {
    const BACKEND_FOLDER = path.join(__dirname, "..", "backend");
    const COURSE_PATH = path.join(BACKEND_FOLDER, "resources", "test-python-course");
    const PASSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-01_passing_exercise");

    const stubContext = createMockActionContext();
    const uri = vscode.Uri.file(PASSING_EXERCISE_PATH);

    let tmcMock: IMock<TMC>;
    let workspaceManagerMock: IMock<WorkspaceManager>;
    let workspaceManagerMockValues: WorkspaceManagerMockValues;

    function actionContext(): ActionContext {
        return {
            ...stubContext,
            tmc: new Ok(tmcMock.object),
            workspaceManager: new Ok(workspaceManagerMock.object),
        };
    }

    setup(function () {
        [tmcMock] = createTMCMock();
        [workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock();
    });

    test("should clean active exercise by default", async function () {
        workspaceManagerMockValues.activeExercise = {
            courseSlug: "test-python-course",
            exerciseSlug: "part01-01_passing_exercise",
            status: ExerciseStatus.Open,
            uri,
        };
        await cleanExercise(actionContext(), undefined);
        tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once());
    });

    test("should not clean active non-exercise", async function () {
        await cleanExercise(actionContext(), undefined);
        tmcMock.verify((x) => x.clean(It.isAny()), Times.never());
    });

    test("should clean provided exercise", async function () {
        await cleanExercise(actionContext(), uri);
        tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once());
    });

    test("should not clean provided non-exercise", async function () {
        workspaceManagerMockValues.uriIsExercise = false;
        await cleanExercise(actionContext(), uri);
        tmcMock.verify((x) => x.clean(It.isAny()), Times.never());
    });
});
