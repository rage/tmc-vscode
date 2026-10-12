import { first, last } from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ExerciseStatus } from "../../../shared/lib"
import { ExerciseIdentifier, makeTmcKind } from "../../../shared/lib"
import { downloadOrUpdateExercises } from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import type { ExerciseDownload, ExerciseDownloadProgress, ExerciseDownloads } from "../../api/langs"
import type { Warned } from "../../api/withOperation"
import type Settings from "../../config/settings"
import * as errors from "../../errors"
import { BottleneckError, InvalidTokenError } from "../../errors"
import { downloadFailures } from "../../ui/downloadFailures"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { idOfMoocExercise, idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import type { SettingsMockValues } from "../mocks/settings"
import { createSettingsMock } from "../mocks/settings"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { exerciseLookupOver } from "../mocks/userdata"

const helloWorld: ExerciseDownload = {
  id: idOfTmcExercise(1),
  path: "/tmc/vscode/test-python-course/hello_world",
}

const otherWorld: ExerciseDownload = {
  id: idOfTmcExercise(2),
  path: "/tmc/vscode/test-python-course/other_world",
}

// Fixed id shared by all tests, since they all operate within a single course.
const TEST_COURSE_ID = idOfTmcCourse(0)

const storedCourse = makeTmcKind({
  id: 0,
  name: "python-course",
  title: "Python Course",
  description: "",
  organization: "mooc",
  exercises: [
    [1, "hello_world"],
    [2, "other_world"],
  ].map(([id, name]) => ({
    id: id as number,
    name: name as string,
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    passed: false,
    softDeadline: null,
  })),
  availablePoints: 2,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
})

const createDownloadResult = (
  downloaded: ExerciseDownload[],
  skipped: ExerciseDownload[],
  failed: [ExerciseDownload, string[]][] = [],
): Result<ExerciseDownloads, Error> => Ok({ downloaded, failed, skipped })

/** What a fake download is handed: every id it was asked for, whichever backend. */
type FakeDownload = (
  ids: ExerciseIdentifier[],
  onDownloaded: (progress: ExerciseDownloadProgress) => void,
  onInterruptHandle?: (interrupt: () => void) => void,
) => Promise<Result<ExerciseDownloads, Error>>

/** Routes both of `langs`' backend downloads to `download`. */
function fakeDownloads(langs: Langs, download: FakeDownload): void {
  langs.downloadTmcExercises = vi.fn<Langs["downloadTmcExercises"]>(
    async (ids, _template, onDownloaded, onHandle) =>
      download(
        ids.map((id) => idOfTmcExercise(id)),
        onDownloaded,
        onHandle,
      ),
  )
  langs.downloadMoocExercises = vi.fn<Langs["downloadMoocExercises"]>(
    async (ids, _courseId, onDownloaded, onHandle) =>
      download(
        ids.map((id) => idOfMoocExercise(id)),
        onDownloaded,
        onHandle,
      ),
  )
}

suite("downloadOrUpdateExercises action", function () {
  let dialogMock: Dialog
  let settingsMock: Settings
  let settingsMockValues: SettingsMockValues
  let tmcMock: Langs
  let tmcMockValues: TMCMockValues
  let recorded: [ExerciseIdentifier, ExerciseStatus][][]
  let subscriptions: vscode.Disposable[]

  const actionContext = (): ReadyActionContext => ({
    ...createMockActionContext({
      startup: {
        langs: tmcMock,
        userData: {
          getCourses: () => [storedCourse],
          getExercise: exerciseLookupOver([storedCourse]),
        } as never,
      },
    }),
    dialog: dialogMock,
    settings: settingsMock,
  })

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    ;[settingsMock, settingsMockValues] = createSettingsMock()
    ;[tmcMock, tmcMockValues] = createTMCMock()
    recorded = []
    const snapshot = (): void => {
      recorded.push(WATCHED_IDS.map((id) => [id, shownStatus(id)]))
    }
    subscriptions = [
      exerciseOperations.onDidChange(snapshot),
      downloadFailures.onDidChange(snapshot),
    ]
  })

  afterEach(function () {
    subscriptions.forEach((subscription) => subscription.dispose())
    vi.restoreAllMocks()
    downloadFailures.clear()
  })

  test("should return empty results if no exercises are given", async function () {
    const result = await downloadResults(actionContext(), [], TEST_COURSE_ID)
    expect(result.successful.length).toBe(0)
    expect(result.failed.length).toBe(0)
  })

  test("should not call TMC-langs if no exercises are given", async function () {
    await downloadOrUpdateExercises(actionContext(), [], TEST_COURSE_ID)
    expect(tmcMock.downloadTmcExercises).not.toHaveBeenCalled()
    expect(tmcMock.downloadMoocExercises).not.toHaveBeenCalled()
  })

  test("should mark exercises as failed (without erroring) if TMC-langs fails", async function () {
    const error = new Error("boom")
    tmcMockValues.downloadTmcExercises = Err(error)
    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
    expect(result.warnings).toEqual([
      { headline: "Failed to download 2 exercises: hello_world, other_world.", error: error },
    ])
  })

  test("reports every failed exercise in one notification, by name", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult(
      [],
      [],
      [
        [helloWorld, ["checksum mismatch"]],
        [otherWorld, ["checksum mismatch"]],
      ],
    )

    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )

    expect(result.warnings).toEqual([
      {
        headline: "Failed to download 2 exercises: hello_world, other_world.",
        error: expect.objectContaining({ message: "checksum mismatch" }),
      },
    ])
  })

  test("names the backend failure that has a remedy when both backends fail", async function () {
    const tmcError = new Error("tmc is down")
    const moocError = new InvalidTokenError("401 unauthorized")
    tmcMockValues.downloadTmcExercises = Err(tmcError)
    tmcMockValues.downloadMoocExercises = Err(moocError)
    vi.spyOn(errors, "presentationFor").mockImplementation((error) => ({
      message: error.message,
      actions: error === moocError ? [{ label: "Log in", command: "tmc.showMoocLogin" }] : [],
    }))

    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfMoocExercise("mooc-exercise")],
      TEST_COURSE_ID,
    )

    expect(result.warnings).toEqual([
      { headline: "Failed to download 2 exercises: hello_world, mooc-exercise.", error: moocError },
    ])
  })

  test("claims a whole download at once", async function () {
    const ids = Array.from({ length: 50 }, (_, index) => idOfTmcExercise(index + 1))
    const claimedAtFirstChange: boolean[] = []
    const subscription = exerciseOperations.onDidChange(() => {
      if (claimedAtFirstChange.length === 0) {
        claimedAtFirstChange.push(
          ids.every((id) => exerciseOperations.isRunning(id, "downloading")),
        )
      }
    })

    await downloadOrUpdateExercises(actionContext(), ids, TEST_COURSE_ID)
    subscription.dispose()

    expect(claimedAtFirstChange).toEqual([true])
  })

  test("marks a running download for a view drawn meanwhile, and clears it after", async function () {
    let duringDownload: unknown
    fakeDownloads(tmcMock, async () => {
      duringDownload = exerciseOperations.isRunning(idOfTmcExercise(1), "downloading")
      return createDownloadResult([helloWorld], [])
    })

    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)

    expect(duringDownload).toBe(true)
    expect(exerciseOperations.isRunning(idOfTmcExercise(1), "downloading")).toBe(false)
  })

  test("refuses to download an exercise already downloading, without calling tmc-langs", async function () {
    const release = Promise.withResolvers<void>()
    fakeDownloads(tmcMock, async () => {
      await release.promise
      return createDownloadResult([helloWorld], [])
    })
    const running = downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)

    const second = await downloadOrUpdateExercises(
      actionContext(),
      [idOfTmcExercise(2), idOfTmcExercise(1)],
      TEST_COURSE_ID,
    )
    release.resolve()
    await running

    expect(second.err && second.val).toBeInstanceOf(BottleneckError)
    expect(tmcMock.downloadTmcExercises).toHaveBeenCalledOnce()
    expect(exerciseOperations.isRunning(idOfTmcExercise(2), "downloading")).toBe(false)
  })

  test("should return ids of successful downloads", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([helloWorld, otherWorld], [])
    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )
    expect(result.successful).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
  })

  test("should return ids of skipped downloads as successful", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([], [helloWorld, otherWorld])
    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )
    expect(result.successful).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
  })

  test("should combine successful and skipped downloads", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([helloWorld], [otherWorld])
    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )
    expect(result.successful).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
  })

  test("should return ids of failed downloads", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult(
      [],
      [],
      [
        [helloWorld, [""]],
        [otherWorld, [""]],
      ],
    )
    const result = await downloadResults(
      actionContext(),
      [idOfTmcExercise(1), idOfTmcExercise(2)],
      TEST_COURSE_ID,
    )
    expect(result.failed).toEqual([idOfTmcExercise(1), idOfTmcExercise(2)])
  })

  test("should handle mooc download results keyed by exercise id", async function () {
    // The bulk mooc download keys results by the requested exercise id (not the
    // editor task id), so the status must land on the exercise the user asked for.
    const moocExerciseId = "exercise-uuid-1"
    tmcMockValues.downloadMoocExercises = createDownloadResult(
      [{ id: idOfMoocExercise(moocExerciseId), path: "/mooc/ex" }],
      [],
    )
    const result = await downloadResults(
      actionContext(),
      [idOfMoocExercise(moocExerciseId)],
      TEST_COURSE_ID,
    )
    expect(result.successful).toEqual([idOfMoocExercise(moocExerciseId)])
    expect(result.failed).toEqual([])
  })

  test("should report failed mooc downloads by exercise id", async function () {
    const moocExerciseId = "exercise-uuid-2"
    tmcMockValues.downloadMoocExercises = createDownloadResult(
      [],
      [],
      [[{ id: idOfMoocExercise(moocExerciseId), path: "/mooc/ex" }, ["boom"]]],
    )
    const result = await downloadResults(
      actionContext(),
      [idOfMoocExercise(moocExerciseId)],
      TEST_COURSE_ID,
    )
    expect(result.failed).toEqual([idOfMoocExercise(moocExerciseId)])
    expect(result.successful).toEqual([])
  })

  test("should report a permanent mooc auth failure and leave its exercises failed", async function () {
    // The CLI now fails the whole mooc batch on a permanent auth failure rather
    // than returning a partial result, so it arrives as an ordinary leg error.
    const downloadedId = "exercise-uuid-3"
    const undownloadedId = "exercise-uuid-4"
    const moocError = new InvalidTokenError("401 unauthorized")
    tmcMockValues.downloadMoocExercises = Err(moocError)

    const result = await downloadResults(
      actionContext(),
      [idOfMoocExercise(downloadedId), idOfMoocExercise(undownloadedId)],
      TEST_COURSE_ID,
    )

    expect(result.warnings).toEqual([
      {
        headline: "Failed to download 2 exercises: exercise-uuid-3, exercise-uuid-4.",
        error: moocError,
      },
    ])
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([
      idOfMoocExercise(downloadedId),
      idOfMoocExercise(undownloadedId),
    ])
  })

  test("should keep an already-downloaded exercise closed when the mooc leg errors", async function () {
    // An exercise that finished before the batch failed was already live-reported
    // as "closed" via the progress callback; it must stay closed in the final
    // broadcast even though the leg as a whole failed.
    const closedId = "exercise-uuid-5"
    const undownloadedId = "exercise-uuid-6"
    fakeDownloads(tmcMock, async (_ids, onDownloaded) => {
      onDownloaded({ id: idOfMoocExercise(closedId), fraction: 1 })
      return Err(new InvalidTokenError("401 unauthorized"))
    })

    await downloadOrUpdateExercises(
      actionContext(),
      [idOfMoocExercise(closedId), idOfMoocExercise(undownloadedId)],
      TEST_COURSE_ID,
    )
    // The last status for each id reflects the final broadcast.
    expect(recordedStatuses(recorded, closedId).at(-1)).toBe("closed")
    expect(recordedStatuses(recorded, undownloadedId).at(-1)).toBe("downloadFailed")
  })

  test("should download template if downloadOldSubmission setting is off", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([helloWorld], [])
    settingsMockValues.downloadOldSubmission = false
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(tmcMock.downloadTmcExercises).toHaveBeenCalledWith(
      [1],
      true,
      expect.any(Function),
      expect.any(Function),
    )
  })

  test("should not necessarily download template if downloadOldSubmission setting is on", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([helloWorld], [])
    settingsMockValues.downloadOldSubmission = true
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(tmcMock.downloadTmcExercises).toHaveBeenCalledWith(
      [1],
      false,
      expect.any(Function),
      expect.any(Function),
    )
  })

  test("should post status updates of succeeding download", async function () {
    // A downloaded exercise is marked "closed" here; the "opened" transition happens
    // later in openExercises.
    fakeDownloads(tmcMock, async (_ids, onDownloaded) => {
      onDownloaded({ id: helloWorld.id, fraction: 0.5 })
      return createDownloadResult([helloWorld], [])
    })
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(first(recordedStatuses(recorded, 1))).toBe("downloading")
    expect(last(recordedStatuses(recorded, 1))).toBe("closed")
  })

  test("should post status updates for skipped download", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([], [helloWorld])
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(first(recordedStatuses(recorded, 1))).toBe("downloading")
    expect(last(recordedStatuses(recorded, 1))).toBe("closed")
  })

  test("should post status updates for failing download", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([], [], [[helloWorld, [""]]])
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(first(recordedStatuses(recorded, 1))).toBe("downloading")
    expect(last(recordedStatuses(recorded, 1))).toBe("downloadFailed")
  })

  test("should post status updates for exercises missing from langs response", async function () {
    tmcMockValues.downloadTmcExercises = createDownloadResult([], [])
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(first(recordedStatuses(recorded, 1))).toBe("downloading")
    expect(last(recordedStatuses(recorded, 1))).toBe("downloadFailed")
  })

  test("should post status updates when TMC-langs operation fails", async function () {
    tmcMockValues.downloadTmcExercises = Err(new Error())
    await downloadOrUpdateExercises(actionContext(), [idOfTmcExercise(1)], TEST_COURSE_ID)
    expect(first(recordedStatuses(recorded, 1))).toBe("downloading")
    expect(last(recordedStatuses(recorded, 1))).toBe("downloadFailed")
  })
})

const WATCHED_IDS = [
  idOfTmcExercise(1),
  idOfTmcExercise(2),
  idOfMoocExercise("exercise-uuid-5"),
  idOfMoocExercise("exercise-uuid-6"),
]

/** An exercise's status as the Courses view derives it while it is not on disk. */
function shownStatus(id: ExerciseIdentifier): ExerciseStatus {
  if (exerciseOperations.isRunning(id, "downloading")) {
    return "downloading"
  }
  return downloadFailures.has(id) ? "downloadFailed" : "closed"
}

/** `downloadOrUpdateExercises` for a test whose download it lets run. */
async function downloadResults(
  ...args: Parameters<typeof downloadOrUpdateExercises>
): Promise<{ successful: ExerciseIdentifier[]; failed: ExerciseIdentifier[] } & Warned> {
  return (await downloadOrUpdateExercises(...args)).unwrap()
}

// Every status recorded for `exerciseId`, in order.
function recordedStatuses(
  records: [ExerciseIdentifier, ExerciseStatus][][],
  exerciseId: number | string,
): ExerciseStatus[] {
  return records.flatMap((statuses) =>
    statuses
      .filter(([id]) => ExerciseIdentifier.toString(id) === String(exerciseId))
      .map(([, status]) => status),
  )
}

suite("downloadOrUpdateExercises cancellation and progress", function () {
  const tmcIds = [idOfTmcExercise(1), idOfTmcExercise(2)]
  const moocIds = [idOfMoocExercise("mooc-1"), idOfMoocExercise("mooc-2")]

  // Mirrors what the CLI reports back for a leg that downloaded everything it was given.
  const downloadedAll = (ids: ExerciseIdentifier[]): Result<ExerciseDownloads, Error> =>
    createDownloadResult(
      ids.map((id) => ({ id, path: "/exercise" })),
      [],
    )

  let cancel: () => void
  let token: vscode.CancellationToken
  let progressReports: { message?: string; increment?: number }[]
  let tmcMock: Langs
  let downloadedIdsPerCall: ExerciseIdentifier[][]

  const actionContext = (): ReadyActionContext => ({
    ...createMockActionContext({ startup: { langs: tmcMock } }),
    // The real Dialog, so the fractions the action reports pass through the
    // production increment wrapper before they are asserted on.
    dialog: new Dialog(),
    settings: createSettingsMock()[0],
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
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("never asks for the mooc exercises once the tmc download is cancelled", async function () {
    let tmcInterrupted = false
    fakeDownloads(tmcMock, async (ids, _onDownloaded, onHandle) => {
      downloadedIdsPerCall.push(ids)
      onHandle?.(() => {
        tmcInterrupted = true
      })
      cancel()
      return Err(new Error("interrupted"))
    })

    const result = await downloadResults(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)

    expect(tmcInterrupted).toBe(true)
    expect(downloadedIdsPerCall).toEqual([tmcIds])
    expect(result.successful).toEqual([])
    expect(result.failed).toEqual([...tmcIds, ...moocIds])
  })

  test("keeps what a leg finished before the cancel, skipped exercises included", async function () {
    fakeDownloads(tmcMock, async (ids) => {
      downloadedIdsPerCall.push(ids)
      // The tmc leg finishes, reporting one exercise skipped as already up to date; the
      // user cancels before the mooc leg starts.
      cancel()
      return createDownloadResult(
        [{ id: tmcIds[0]!, path: "/exercise" }],
        [{ id: tmcIds[1]!, path: "/exercise" }],
      )
    })

    const result = await downloadResults(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)

    expect(downloadedIdsPerCall).toEqual([tmcIds])
    expect(result.successful).toEqual(tmcIds)
    expect(result.failed).toEqual(moocIds)
  })

  test("kills a leg that was still starting up when the user cancelled", async function () {
    const interruptedLegs: ExerciseIdentifier[][] = []
    fakeDownloads(tmcMock, async (ids, _onDownloaded, onHandle) => {
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
    })

    await downloadOrUpdateExercises(actionContext(), [...tmcIds, ...moocIds], TEST_COURSE_ID)

    expect(interruptedLegs).toEqual([moocIds])
  })

  test("keeps the progress bar moving while the second backend downloads", async function () {
    fakeDownloads(tmcMock, async (ids, onDownloaded) => {
      // Each backend counts its own exercises from 0 to 1, as the CLI does.
      ids.forEach((id, index) =>
        onDownloaded({
          id,
          fraction: (index + 1) / ids.length,
          message: `Downloaded ${ExerciseIdentifier.toString(id)}`,
        }),
      )
      return downloadedAll(ids)
    })

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
