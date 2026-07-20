import { first, last } from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { downloadOrUpdateExercises } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type Settings from "../../config/settings"
import { TmcPanel } from "../../panels/TmcPanel"
import type {
  DownloadOrUpdateMoocCourseExercisesResult,
  DownloadOrUpdateTmcCourseExercisesResult,
  TmcExerciseDownload,
} from "../../shared/langsSchema"
import type { ExtensionToWebview } from "../../shared/shared"
import { ExerciseIdentifier } from "../../shared/shared"
import type { ExerciseStatus } from "../../ui/types"
import type UI from "../../ui/ui"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import type { SettingsMockValues } from "../mocks/settings"
import { createSettingsMock } from "../mocks/settings"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createUIMock } from "../mocks/ui"

const helloWorld: TmcExerciseDownload = {
  "course-slug": "python-course",
  "exercise-slug": "hello_world",
  id: 1,
  path: "/tmc/vscode/test-python-course/hello_world",
}

const otherWorld: TmcExerciseDownload = {
  "course-slug": "python-course",
  "exercise-slug": "other_world",
  id: 2,
  path: "/tmc/vscode/test-python-course/other_world",
}

const createDownloadResult = (
  downloaded: TmcExerciseDownload[],
  skipped: TmcExerciseDownload[],
  failed: [TmcExerciseDownload, string[]][] | undefined,
): Result<
  [DownloadOrUpdateTmcCourseExercisesResult, DownloadOrUpdateMoocCourseExercisesResult],
  Error
> => {
  return Ok([
    {
      downloaded,
      failed,
      skipped,
    },
    { downloaded: [], failed: [], skipped: [] },
  ])
}

suite("downloadOrUpdateExercises action", function () {
  const stubContext = createMockActionContext()

  let dialogMock: Dialog
  let settingsMock: Settings
  let settingsMockValues: SettingsMockValues
  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let uiMock: UI
  let webviewMessages: ExtensionToWebview[]

  const actionContext = (): ActionContext => ({
    ...stubContext,
    dialog: dialogMock,
    settings: settingsMock,
    langs: new Ok(tmcMock),
    ui: uiMock,
  })

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    ;[settingsMock, settingsMockValues] = createSettingsMock()
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[uiMock] = createUIMock()
    webviewMessages = []
    // The action posts exercise-status updates through the static
    // TmcPanel.postMessage sink; capture them so the tests can assert on them.
    vi.spyOn(TmcPanel, "postMessage").mockImplementation(async (...messages) => {
      webviewMessages.push(...messages)
    })
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("should return empty results if no exercises are given", async function () {
    const result = (await downloadOrUpdateExercises(actionContext(), [])).unwrap()
    expect(result.successful.length).toBe(0)
    expect(result.failed.length).toBe(0)
  })

  test("should not call TMC-langs if no exercises are given", async function () {
    await downloadOrUpdateExercises(actionContext(), [])
    expect(tmcMock.downloadExercises).not.toHaveBeenCalled()
  })

  test("should return error if TMC-langs fails", async function () {
    const error = new Error()
    tmcMockValues.downloadExercises = Err(error)
    const result = await downloadOrUpdateExercises(actionContext(), [
      ExerciseIdentifier.from(1),
      ExerciseIdentifier.from(2),
    ])
    expect(result.val).toBe(error)
  })

  // The action returns ExerciseIdentifier objects (not raw numbers) for
  // successful/failed; earlier assertions compared against bare numbers.
  test("should return ids of successful downloads", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld, otherWorld], [], undefined)
    const result = (
      await downloadOrUpdateExercises(actionContext(), [
        ExerciseIdentifier.from(1),
        ExerciseIdentifier.from(2),
      ])
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should return ids of skipped downloads as successful", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [helloWorld, otherWorld], undefined)
    const result = (
      await downloadOrUpdateExercises(actionContext(), [
        ExerciseIdentifier.from(1),
        ExerciseIdentifier.from(2),
      ])
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should combine successful and skipped downloads", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [otherWorld], undefined)
    const result = (
      await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should return ids of failed downloads", async function () {
    tmcMockValues.downloadExercises = createDownloadResult(
      [],
      [],
      [
        [helloWorld, [""]],
        [otherWorld, [""]],
      ],
    )
    const result = (
      await downloadOrUpdateExercises(actionContext(), [
        ExerciseIdentifier.from(1),
        ExerciseIdentifier.from(2),
      ])
    ).unwrap()
    expect(result.failed).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should handle mooc task-id download results", async function () {
    const moocTaskId = "task-uuid-1"
    tmcMockValues.downloadExercises = Ok([
      { downloaded: [], failed: [], skipped: [] },
      { downloaded: [{ "task-id": moocTaskId, path: "/mooc/ex" }], failed: [], skipped: [] },
    ])
    const result = (
      await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(moocTaskId)])
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(moocTaskId)])
    expect(result.failed).toEqual([])
  })

  test("should report failed mooc downloads", async function () {
    const moocTaskId = "task-uuid-2"
    tmcMockValues.downloadExercises = Ok([
      { downloaded: [], failed: [], skipped: [] },
      {
        downloaded: [],
        failed: [[{ "task-id": moocTaskId, path: "/mooc/ex" }, ["boom"]]],
        skipped: [],
      },
    ])
    const result = (
      await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(moocTaskId)])
    ).unwrap()
    expect(result.failed).toEqual([ExerciseIdentifier.from(moocTaskId)])
    expect(result.successful).toEqual([])
  })

  test("should download template if downloadOldSubmission setting is off", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined)
    settingsMockValues.getDownloadOldSubmission = false
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(tmcMock.downloadExercises).toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.anything(),
    )
    expect(tmcMock.downloadExercises).not.toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.anything(),
    )
  })

  test("should not necessarily download template if downloadOldSubmission setting is on", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined)
    settingsMockValues.getDownloadOldSubmission = true
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(tmcMock.downloadExercises).not.toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.anything(),
    )
    expect(tmcMock.downloadExercises).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.anything(),
    )
  })

  test("should post status updates of succeeding download", async function () {
    // The progress callback carries an ExerciseIdentifier (the action calls
    // ExerciseIdentifier.unwrap on it). A downloaded exercise is marked
    // "closed" here; the "opened" transition happens later in openExercises.
    tmcMock.downloadExercises = vi.fn(async (_1, _2, cb) => {
      cb?.({ id: ExerciseIdentifier.from(helloWorld.id), percent: 0.5 })
      return createDownloadResult([helloWorld], [], undefined)
    }) as Langs["downloadExercises"]
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "closed"))
  })

  test("should post status updates for skipped download", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [helloWorld], undefined)
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "closed"))
  })

  test("should post status updates for failing download", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [], [[helloWorld, [""]]])
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })

  test("should post status updates for exercises missing from langs response", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [], undefined)
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })

  test("should post status updates when TMC-langs operation fails", async function () {
    const error = new Error()
    tmcMockValues.downloadExercises = Err(error)
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)])
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })
})

// Mirrors the message the action posts via TmcPanel.postMessage.
function wrapToMessage(exerciseId: number, status: ExerciseStatus): ExtensionToWebview {
  return {
    type: "exerciseStatusChange",
    target: {
      type: "CourseDetails",
    },
    exerciseId: ExerciseIdentifier.from(exerciseId),
    status,
  }
}
