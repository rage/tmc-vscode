import { expect } from "chai";
import { first, last } from "lodash";
import { Err, Ok, Result } from "ts-results";
import { IMock, It, Times } from "typemoq";

import { downloadOrUpdateExercises } from "../../actions";
import { ActionContext } from "../../actions/types";
import Dialog from "../../api/dialog";
import TMC from "../../api/tmc";
import Settings from "../../config/settings";
import {
    DownloadOrUpdateTmcCourseExercisesResult,
    TmcExerciseDownload,
} from "../../shared/langsSchema";
import { ExerciseStatus, WebviewMessage } from "../../ui/types";
import UI from "../../ui/ui";
import { createMockActionContext } from "../mocks/actionContext";
import { createDialogMock } from "../mocks/dialog";
import { createSettingsMock, SettingsMockValues } from "../mocks/settings";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";
import { createUIMock } from "../mocks/ui";

const helloWorld: TmcExerciseDownload = {
    "course-slug": "python-course",
    "exercise-slug": "hello_world",
    id: 1,
    path: "/tmc/vscode/test-python-course/hello_world",
};

const otherWorld: TmcExerciseDownload = {
    "course-slug": "python-course",
    "exercise-slug": "other_world",
    id: 2,
    path: "/tmc/vscode/test-python-course/other_world",
};

suite("downloadOrUpdateExercises action", function () {
    const stubContext = createMockActionContext();

    let dialogMock: IMock<Dialog>;
    let settingsMock: IMock<Settings>;
    let settingsMockValues: SettingsMockValues;
    let tmcMock: IMock<TMC>;
    let tmcMockValues: TMCMockValues;
    let uiMock: IMock<UI>;
    let webviewMessages: WebviewMessage[];

    const actionContext = (): ActionContext => ({
        ...stubContext,
        dialog: dialogMock.object,
        settings: settingsMock.object,
        tmc: new Ok(tmcMock.object),
        ui: uiMock.object,
    });

    const createDownloadResult = (
        downloaded: TmcExerciseDownload[],
        skipped: TmcExerciseDownload[],
        failed: Array<[TmcExerciseDownload, string[]]> | undefined,
    ): Result<DownloadOrUpdateTmcCourseExercisesResult, Error> => {
        return Ok({
            downloaded,
            failed,
            skipped,
        });
    };

    setup(function () {
        [dialogMock] = createDialogMock();
        [settingsMock, settingsMockValues] = createSettingsMock();
        [tmcMock, tmcMockValues] = createTMCMock();
        [uiMock] = createUIMock();
        webviewMessages = [];
    });

    test("should return empty results if no exercises are given", async function () {
        const result = (await downloadOrUpdateExercises(actionContext(), [])).unwrap();
        expect(result.successful.length).to.be.equal(0);
        expect(result.failed.length).to.be.equal(0);
    });

    test("should not call TMC-langs if no exercises are given", async function () {
        await downloadOrUpdateExercises(actionContext(), []);
        expect(
            tmcMock.verify(
                (x) => x.downloadExercises(It.isAny(), It.isAny(), It.isAny()),
                Times.never(),
            ),
        );
    });

    test("should return error if TMC-langs fails", async function () {
        const error = new Error();
        tmcMockValues.downloadExercises = Err(error);
        const result = await downloadOrUpdateExercises(actionContext(), [1, 2]);
        expect(result.val).to.be.equal(error);
    });

    test("should return ids of successful downloads", async function () {
        tmcMockValues.downloadExercises = createDownloadResult(
            [helloWorld, otherWorld],
            [],
            undefined,
        );
        const result = (await downloadOrUpdateExercises(actionContext(), [1, 2])).unwrap();
        expect(result.successful).to.be.deep.equal([1, 2]);
    });

    test("should return ids of skipped downloads as successful", async function () {
        tmcMockValues.downloadExercises = createDownloadResult(
            [],
            [helloWorld, otherWorld],
            undefined,
        );
        const result = (await downloadOrUpdateExercises(actionContext(), [1, 2])).unwrap();
        expect(result.successful).to.be.deep.equal([1, 2]);
    });

    test("should combine successful and skipped downloads", async function () {
        tmcMockValues.downloadExercises = createDownloadResult(
            [helloWorld],
            [otherWorld],
            undefined,
        );
        const result = (await downloadOrUpdateExercises(actionContext(), [1])).unwrap();
        expect(result.successful).to.be.deep.equal([1, 2]);
    });

    test("should return ids of failed downloads", async function () {
        tmcMockValues.downloadExercises = createDownloadResult(
            [],
            [],
            [
                [helloWorld, [""]],
                [otherWorld, [""]],
            ],
        );
        const result = (await downloadOrUpdateExercises(actionContext(), [1, 2])).unwrap();
        expect(result.failed).to.be.deep.equal([1, 2]);
    });

    test("should download template if downloadOldSubmission setting is off", async function () {
        tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined);
        settingsMockValues.getDownloadOldSubmission = false;
        await downloadOrUpdateExercises(actionContext(), [1]);
        tmcMock.verify(
            (x) => x.downloadExercises(It.isAny(), It.isValue(true), It.isAny()),
            Times.once(),
        );
        tmcMock.verify(
            (x) => x.downloadExercises(It.isAny(), It.isValue(false), It.isAny()),
            Times.never(),
        );
    });

    test("should not necessarily download template if downloadOldSubmission setting is on", async function () {
        tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined);
        settingsMockValues.getDownloadOldSubmission = true;
        await downloadOrUpdateExercises(actionContext(), [1]);
        tmcMock.verify(
            (x) => x.downloadExercises(It.isAny(), It.isValue(true), It.isAny()),
            Times.never(),
        );
        tmcMock.verify(
            (x) => x.downloadExercises(It.isAny(), It.isValue(false), It.isAny()),
            Times.once(),
        );
    });

    test.skip("should post status updates of succeeding download", async function () {
        tmcMock.reset();
        tmcMock
            .setup((x) => x.downloadExercises(It.isAny(), It.isAny(), It.isAny()))
            .returns(async (_1, _2, cb) => {
                // Callback is only used for successful downloads
                cb({ id: helloWorld.id, percent: 0.5 });
                return createDownloadResult([helloWorld], [], undefined);
            });
        await downloadOrUpdateExercises(actionContext(), [1]);
        expect(webviewMessages.length).to.be.greaterThanOrEqual(
            2,
            "expected at least two status messages",
        );
        expect(first(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloading"),
            'expected first message to be "downloading"',
        );
        expect(last(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "opened"),
            'expected last message to be "opened"',
        );
    });

    test.skip("should post status updates for skipped download", async function () {
        tmcMockValues.downloadExercises = createDownloadResult([], [helloWorld], undefined);
        await downloadOrUpdateExercises(actionContext(), [1]);
        expect(webviewMessages.length).to.be.greaterThanOrEqual(
            2,
            "expected at least two status messages",
        );
        expect(first(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloading"),
            'expected first message to be "downloading"',
        );
        expect(last(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "closed"),
            'expected last message to be "closed"',
        );
    });

    test.skip("should post status updates for failing download", async function () {
        tmcMockValues.downloadExercises = createDownloadResult([], [], [[helloWorld, [""]]]);
        await downloadOrUpdateExercises(actionContext(), [1]);
        expect(webviewMessages.length).to.be.greaterThanOrEqual(
            2,
            "expected at least two status messages",
        );
        expect(first(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloading"),
            'expected first message to be "downloading"',
        );
        expect(last(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloadFailed"),
            'expected last message to be "downloadFailed"',
        );
    });

    test.skip("should post status updates for exercises missing from langs response", async function () {
        tmcMockValues.downloadExercises = createDownloadResult([], [], undefined);
        await downloadOrUpdateExercises(actionContext(), [1]);
        expect(webviewMessages.length).to.be.greaterThanOrEqual(
            2,
            "expected at least two status messages",
        );
        expect(first(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloading"),
            'expected first message to be "downloading"',
        );
        expect(last(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloadFailed"),
            'expected last message to be "downloadFailed"',
        );
    });

    test.skip("should post status updates when TMC-langs operation fails", async function () {
        const error = new Error();
        tmcMockValues.downloadExercises = Err(error);
        await downloadOrUpdateExercises(actionContext(), [1]);
        expect(webviewMessages.length).to.be.greaterThanOrEqual(
            2,
            "expected at least two status messages",
        );
        expect(first(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloading"),
            'expected first message to be "downloading"',
        );
        expect(last(webviewMessages)).to.be.deep.equal(
            wrapToMessage(helloWorld.id, "downloadFailed"),
            'expected last message to be "downloadFailed"',
        );
    });
});

// These kind of functions should maybe be in utils?
function wrapToMessage(exerciseId: number, status: ExerciseStatus): WebviewMessage {
    return {
        command: "exerciseStatusChange",
        exerciseId,
        status,
    };
}
