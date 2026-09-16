import { first, last } from "lodash"
import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { downloadOrUpdateExercises } from "../../actions"
import type { ActionContext } from "../../actions/types"
import Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type Settings from "../../config/settings"
import { InvalidTokenError } from "../../errors"
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
  mooc: { downloaded: [], failed: [], skipped: [] },
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

  test("should report a permanent mooc auth failure and leave its exercises failed", async function () {
    // The CLI now fails the whole mooc batch on a permanent auth failure rather
    // than returning a partial result, so it arrives as an ordinary leg error.
    const downloadedId = "exercise-uuid-3"
    const undownloadedId = "exercise-uuid-4"
    const moocError = new InvalidTokenError("401 unauthorized")
    tmcMockValues.downloadExercises = {
      tmc: { downloaded: [], failed: [], skipped: [] },
      mooc: { downloaded: [], failed: [], skipped: [] },
      moocError,
    }

    const result = (
      await downloadOrUpdateExercises(
        actionContext(),
        [ExerciseIdentifier.from(downloadedId), ExerciseIdentifier.from(undownloadedId)],
        TEST_COURSE_ID,
      )
    ).unwrap()

    expect(dialogMock.errorNotification).toHaveBeenCalledWith(
      "Failed to download exercises from courses.mooc.fi.",
      moocError,
    )
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([
      ExerciseIdentifier.from(downloadedId),
      ExerciseIdentifier.from(undownloadedId),
    ])
  })

  test("should keep an already-downloaded exercise closed when the mooc leg errors", async function () {
    // An exercise that finished before the batch failed was already live-reported
    // as "closed" via the progress callback; it must stay closed in the final
    // broadcast even though the leg as a whole failed.
    const closedId = "exercise-uuid-5"
    const undownloadedId = "exercise-uuid-6"
    tmcMock.downloadExercises = vi.fn(async (_1, _2, cb) => {
      cb?.({ id: ExerciseIdentifier.from(closedId), fraction: 1 })
      return {
        tmc: { downloaded: [], failed: [], skipped: [] },
        mooc: { downloaded: [], failed: [], skipped: [] },
        moocError: new InvalidTokenError("401 unauthorized"),
      }
    }) as Langs["downloadExercises"]

    await downloadOrUpdateExercises(
      actionContext(),
      [ExerciseIdentifier.from(closedId), ExerciseIdentifier.from(undownloadedId)],
      TEST_COURSE_ID,
    )
    // The last message for each id reflects the final broadcast.
    const lastMessageFor = (id: string): ExtensionToWebview | undefined =>
      webviewMessages
        .filter((m) => "exerciseId" in m && ExerciseIdentifier.unwrap(m.exerciseId) === id)
        .at(-1)
    expect(lastMessageFor(closedId)).toEqual(wrapToMessage(closedId, "closed"))
    expect(lastMessageFor(undownloadedId)).toEqual(wrapToMessage(undownloadedId, "downloadFailed"))
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
      cb?.({ id: ExerciseIdentifier.from(helloWorld.id), fraction: 0.5 })
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

suite("downloadOrUpdateExercises cancellation and progress", function () {
  const stubContext = createMockActionContext()
  const tmcIds = [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)]
  const moocIds = [ExerciseIdentifier.from("mooc-1"), ExerciseIdentifier.from("mooc-2")]

  const noTmcDownloads: DownloadExercisesMockResult["tmc"] = {
    downloaded: [],
    failed: [],
    skipped: [],
  }
  const noMoocDownloads: DownloadExercisesMockResult["mooc"] = {
    downloaded: [],
    failed: [],
    skipped: [],
  }

  // Mirrors what the CLI reports back for a leg that downloaded everything it was given.
  const downloadedAll = (ids: ExerciseIdentifier[]): DownloadExercisesMockResult =>
    ids[0]?.kind === "tmc"
      ? {
          tmc: {
            downloaded: ids.map((id) => ({
              "course-slug": "python-course",
              "exercise-slug": `exercise-${ExerciseIdentifier.unwrap(id)}`,
              id: ExerciseIdentifier.unwrap(id) as number,
              path: "/tmc/exercise",
            })),
            failed: [],
            skipped: [],
          },
          mooc: noMoocDownloads,
        }
      : {
          tmc: noTmcDownloads,
          mooc: {
            downloaded: ids.map((id) => ({
              "exercise-id": ExerciseIdentifier.unwrap(id) as string,
              path: "/mooc/exercise",
            })),
            failed: [],
            skipped: [],
          },
        }

  let cancel: () => void
  let token: vscode.CancellationToken
  let progressReports: { message?: string; increment?: number }[]
  let tmcMock: Langs
  let downloadedIdsPerCall: ExerciseIdentifier[][]

  const actionContext = (): ActionContext => ({
    ...stubContext,
    // The real Dialog, so the fractions the action reports pass through the
    // production increment wrapper before they are asserted on.
    dialog: new Dialog(),
    settings: createSettingsMock()[0],
    langs: new Ok(tmcMock),
  })

  beforeEach(function () {
    ;[tmcMock] = createTMCMock()
    downloadedIdsPerCall = []
    progressReports = []
    const cancellationListeners: (() => void)[] = []
    let cancellationRequested = false
    cancel = (): void => {
      cancellationRequested = true
      cancellationListeners.forEach((listener) => listener())
    }
    token = {
      get isCancellationRequested(): boolean {
        return cancellationRequested
      },
      onCancellationRequested: (listener: () => void) => {
        cancellationListeners.push(listener)
        return { dispose: (): void => {} }
      },
    } as unknown as vscode.CancellationToken
    vi.spyOn(vscode.window, "withProgress").mockImplementation((async (
      _options: unknown,
      task: (
        progress: { report: (value: { message?: string; increment?: number }) => void },
        cancellationToken: vscode.CancellationToken,
      ) => Promise<unknown>,
    ) =>
      task(
        {
          report: (value): void => {
            progressReports.push(value)
          },
        },
        token,
      )) as unknown as typeof vscode.window.withProgress)
    vi.spyOn(TmcPanel, "postMessage").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("never asks for the mooc exercises once the tmc download is cancelled", async function () {
    let tmcInterrupted = false
    tmcMock.downloadExercises = vi.fn(
      async (ids, _template, _onDownloaded, _courseId, onHandle) => {
        downloadedIdsPerCall.push(ids)
        onHandle?.(() => {
          tmcInterrupted = true
        })
        cancel()
        return { ...downloadedAll(ids), tmcError: new Error("interrupted") }
      },
    ) as Langs["downloadExercises"]

    const result = (
      await downloadOrUpdateExercises(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)
    ).unwrap()

    expect(tmcInterrupted).toBe(true)
    expect(downloadedIdsPerCall).toEqual([tmcIds])
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([...tmcIds, ...moocIds])
  })

  test("kills a leg that was still starting up when the user cancelled", async function () {
    const interruptedLegs: ExerciseIdentifier[][] = []
    tmcMock.downloadExercises = vi.fn(
      async (ids, _template, _onDownloaded, _courseId, onHandle) => {
        downloadedIdsPerCall.push(ids)
        if (ids[0]?.kind === "mooc") {
          // The token fires between the leg's start and the CLI handing back its
          // interrupt handle.
          cancel()
        }
        onHandle?.(() => {
          interruptedLegs.push(ids)
        })
        return downloadedAll(ids)
      },
    ) as Langs["downloadExercises"]

    await downloadOrUpdateExercises(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)

    expect(interruptedLegs).toEqual([moocIds])
  })

  test("keeps the progress bar moving while the second backend downloads", async function () {
    tmcMock.downloadExercises = vi.fn(async (ids, _template, onDownloaded) => {
      // Each backend counts its own exercises from 0 to 1, as the CLI does.
      ids.forEach((id: ExerciseIdentifier, index: number) =>
        onDownloaded?.({
          id,
          fraction: (index + 1) / ids.length,
          message: `Downloaded ${ExerciseIdentifier.unwrap(id)}`,
        }),
      )
      return downloadedAll(ids)
    }) as Langs["downloadExercises"]

    await downloadOrUpdateExercises(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)

    // The wrapper drops any report that does not advance the bar, so the mooc
    // leg's messages only survive if the fraction kept climbing past the tmc leg.
    expect(progressReports.filter((report) => (report.increment ?? 0) > 0)).toEqual([
      { increment: 25, message: "Downloaded 1" },
      { increment: 25, message: "Downloaded 2" },
      { increment: 25, message: "Downloaded mooc-1" },
      { increment: 25, message: "Downloaded mooc-2" },
    ])
  })
})
