import { first, last } from "lodash"
import { Ok } from "ts-results"
import { vi } from "vitest"

import { downloadOrUpdateExercises } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type Settings from "../../config/settings"
import { TmcPanel } from "../../panels/TmcPanel"
import type { TmcExerciseDownload } from "../../shared/langsSchema"
import type { ExtensionToWebview } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import type { ExerciseStatus } from "../../ui/types"
import type UI from "../../ui/ui"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import type { SettingsMockValues } from "../mocks/settings"
import { createSettingsMock } from "../mocks/settings"
import type { DownloadExercisesMockResult, TMCMockValues } from "../mocks/tmc"
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

// Fixed id shared by all tests, since they all operate within a single course.
const TEST_COURSE_ID = CourseIdentifier.from(0)

const createDownloadResult = (
  downloaded: TmcExerciseDownload[],
  skipped: TmcExerciseDownload[],
  failed: [TmcExerciseDownload, string[]][] | undefined,
): DownloadExercisesMockResult => ({
  tmc: { downloaded, failed, skipped },
  mooc: { downloaded: [], failed: [], skipped: [], not_attempted: [], stopped_for_auth: false },
})

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
    const result = (await downloadOrUpdateExercises(actionContext(), [], TEST_COURSE_ID)).unwrap()
    expect(result.successful.length).toBe(0)
    expect(result.failed.length).toBe(0)
  })

  test("should not call TMC-langs if no exercises are given", async function () {
    await downloadOrUpdateExercises(actionContext(), [], TEST_COURSE_ID)
    expect(tmcMock.downloadExercises).not.toHaveBeenCalled()
  })

  test("should mark exercises as failed (without erroring) if TMC-langs fails", async function () {
    // A backend-level failure is reported via `tmcError`/`moocError`, not by
    // the whole action erroring.
    const error = new Error("boom")
    tmcMockValues.downloadExercises = { ...tmcMockValues.downloadExercises, tmcError: error }
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      expect.stringContaining("tmc.mooc.fi"),
      error,
    )
  })

  // The action returns ExerciseIdentifier objects (not raw numbers) for
  // successful/failed; earlier assertions compared against bare numbers.
  test("should return ids of successful downloads", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld, otherWorld], [], undefined)
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should return ids of skipped downloads as successful", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [helloWorld, otherWorld], undefined)
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should combine successful and skipped downloads", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [otherWorld], undefined)
    const result = (
      await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
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
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.failed).toEqual([ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)])
  })

  test("should handle mooc download results keyed by exercise id", async function () {
    // The bulk mooc download keys results by the requested exercise id (not the
    // editor task id), so the status must land on the exercise the user asked for.
    const moocExerciseId = "exercise-uuid-1"
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: {
        downloaded: [{ "exercise-id": moocExerciseId, path: "/mooc/ex" }],
        failed: [],
        skipped: [],
        not_attempted: [],
        stopped_for_auth: false,
      },
    }
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(moocExerciseId)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(moocExerciseId)])
    expect(result.failed).toEqual([])
  })

  test("should report failed mooc downloads by exercise id", async function () {
    const moocExerciseId = "exercise-uuid-2"
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: {
        downloaded: [],
        failed: [[{ "exercise-id": moocExerciseId, path: "/mooc/ex" }, ["boom"]]],
        skipped: [],
        not_attempted: [],
        stopped_for_auth: false,
      },
    }
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(moocExerciseId)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.failed).toEqual([ExerciseIdentifier.from(moocExerciseId)])
    expect(result.successful).toEqual([])
  })

  test("should mark mooc not_attempted exercises as failed when the batch stops for auth", async function () {
    const downloadedId = "exercise-uuid-3"
    const notAttemptedId = "exercise-uuid-4"
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: {
        downloaded: [{ "exercise-id": downloadedId, path: "/mooc/ex" }],
        failed: [],
        skipped: [],
        not_attempted: [{ "exercise-id": notAttemptedId, path: "/mooc/ex2" }],
        stopped_for_auth: true,
      },
    }
    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(downloadedId), ExerciseIdentifier.from(notAttemptedId)],
        TEST_COURSE_ID,
      )
    ).unwrap()
    expect(result.successful).toEqual([ExerciseIdentifier.from(downloadedId)])
    expect(result.failed).toEqual([ExerciseIdentifier.from(notAttemptedId)])
  })

  test("should not flip an already-closed exercise back to failed when the mooc batch stops for auth", async function () {
    // The exercise that finished downloading before the batch stopped was
    // already live-reported as "closed" via the progress callback; it must
    // stay "closed" in the final broadcast even though the overall mooc
    // result is now partial. Only the never-attempted exercise should end up
    // non-"closed".
    const closedId = "exercise-uuid-5"
    const notAttemptedId = "exercise-uuid-6"
    tmcMock.downloadExercises = vi.fn(async (_1, _2, cb) => {
      cb?.({ id: ExerciseIdentifier.from(closedId), percent: 1 })
      return {
        tmc: { downloaded: [], failed: [], skipped: [] },
        mooc: {
          downloaded: [{ "exercise-id": closedId, path: "/mooc/ex" }],
          failed: [],
          skipped: [],
          not_attempted: [{ "exercise-id": notAttemptedId, path: "/mooc/ex2" }],
          stopped_for_auth: true,
        },
      }
    }) as Langs["downloadExercises"]

    await downloadOrUpdateExercises(
      actionContext(),
      [ExerciseIdentifier.from(closedId), ExerciseIdentifier.from(notAttemptedId)],
      TEST_COURSE_ID,
    )
    // The last message for each id reflects the final broadcast.
    const lastMessageFor = (id: string): ExtensionToWebview | undefined =>
      webviewMessages
        .filter((m) => "exerciseId" in m && ExerciseIdentifier.unwrap(m.exerciseId) === id)
        .at(-1)
    expect(lastMessageFor(closedId)).toEqual(wrapToMessage(closedId, "closed"))
    expect(lastMessageFor(notAttemptedId)).toEqual(wrapToMessage(notAttemptedId, "downloadFailed"))
  })

  test("should show a session-expired message with the completed count when the mooc batch stops for auth", async function () {
    const downloadedId = "exercise-uuid-7"
    const skippedId = "exercise-uuid-8"
    const notAttemptedId = "exercise-uuid-9"
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: {
        downloaded: [{ "exercise-id": downloadedId, path: "/mooc/ex" }],
        failed: [],
        skipped: [{ "exercise-id": skippedId, path: "/mooc/ex2" }],
        not_attempted: [{ "exercise-id": notAttemptedId, path: "/mooc/ex3" }],
        stopped_for_auth: true,
      },
    }
    await downloadOrUpdateExercises(
      actionContext(),
      [
        ExerciseIdentifier.from(downloadedId),
        ExerciseIdentifier.from(skippedId),
        ExerciseIdentifier.from(notAttemptedId),
      ],
      TEST_COURSE_ID,
    )
    // 2 of 3 (downloaded + skipped, out of downloaded + skipped + not_attempted) completed.
    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      "Downloaded 2 of 3 exercises from courses.mooc.fi, then your session expired —" +
        " the rest will be available once you log in again.",
    )
  })

  test("should not show the generic mooc failure message when the batch stops for auth", async function () {
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: {
        downloaded: [],
        failed: [],
        skipped: [],
        not_attempted: [{ "exercise-id": "exercise-uuid-10", path: "/mooc/ex" }],
        stopped_for_auth: true,
      },
    }
    await downloadOrUpdateExercises(
      actionContext(),
      [ExerciseIdentifier.from("exercise-uuid-10")],
      TEST_COURSE_ID,
    )
    expect(dialogMock.errorNotification).not.toHaveBeenCalledWith(
      expect.stringContaining("Failed to download exercises from courses.mooc.fi."),
      expect.anything(),
    )
  })

  test("should download template if downloadOldSubmission setting is off", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined)
    settingsMockValues.getDownloadOldSubmission = false
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(tmcMock.downloadExercises).toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.anything(),
      undefined,
      expect.any(Function),
    )
    expect(tmcMock.downloadExercises).not.toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.anything(),
      undefined,
      expect.any(Function),
    )
  })

  test("should not necessarily download template if downloadOldSubmission setting is on", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([helloWorld], [], undefined)
    settingsMockValues.getDownloadOldSubmission = true
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(tmcMock.downloadExercises).not.toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.anything(),
      undefined,
      expect.any(Function),
    )
    expect(tmcMock.downloadExercises).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.anything(),
      undefined,
      expect.any(Function),
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
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "closed"))
  })

  test("should post status updates for skipped download", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [helloWorld], undefined)
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "closed"))
  })

  test("should post status updates for failing download", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [], [[helloWorld, [""]]])
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })

  test("should post status updates for exercises missing from langs response", async function () {
    tmcMockValues.downloadExercises = createDownloadResult([], [], undefined)
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })

  test("should post status updates when TMC-langs operation fails", async function () {
    tmcMockValues.downloadExercises = {
      ...tmcMockValues.downloadExercises,
      tmcError: new Error(),
    }
    await downloadOrUpdateExercises(actionContext(), [ExerciseIdentifier.from(1)], TEST_COURSE_ID)
    expect(webviewMessages.length).toBeGreaterThanOrEqual(2)
    expect(first(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloading"))
    expect(last(webviewMessages)).toEqual(wrapToMessage(helloWorld.id, "downloadFailed"))
  })
})

// Mirrors the message the action posts via TmcPanel.postMessage.
function wrapToMessage(exerciseId: number | string, status: ExerciseStatus): ExtensionToWebview {
  return {
    type: "exerciseStatusChange",
    target: {
      type: "CourseDetails",
    },
    courseId: TEST_COURSE_ID,
    exerciseId: ExerciseIdentifier.from(exerciseId),
    status,
  }
}
