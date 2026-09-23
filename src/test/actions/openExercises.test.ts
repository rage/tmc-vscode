import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadExercisesForUi } from "../../actions/downloadExercisesForUi"
import { downloadAndOpenExercises } from "../../actions/openExercises"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/downloadExercisesForUi", () => ({
  downloadExercisesForUi: vi.fn(async () => Ok([])),
}))

const moocCourse: MoocLocalCourseData = {
  id: "instance-uuid-1",
  name: "mooc-python-course",
  title: "Mooc Python",
  description: null,
  organization: "mooc",
  exercises: [
    {
      id: "mooc-ex-uuid-1",
      name: "mooc_hello",
      availablePoints: 1,
      awardedPoints: 0,
      deadline: null,
      passed: false,
      softDeadline: null,
    },
  ],
  availablePoints: 1,
  awardedPoints: 0,
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
}

const GIB = 1024 ** 3

// `UNDER_8GB_RAM` is read once at module load, so each machine size needs a fresh module
// graph with `os.totalmem` already stubbed.
async function openExercisesOnMachineWith(totalRamBytes: number) {
  vi.resetModules()
  vi.doMock("os", async (importOriginal) => ({
    ...(await importOriginal<typeof import("os")>()),
    totalmem: () => totalRamBytes,
  }))
  return (await import("../../actions/openExercises")).openExercises
}

function contextWithOpenExercises(openCount: number): ReadyActionContext {
  const openExerciseList = Array.from({ length: openCount }, (_unused, index) => ({
    backend: "mooc",
    courseSlug: "mooc-python-course",
    exerciseSlug: `mooc_hello_${index}`,
    status: ExerciseStatus.Open,
  }))
  return createMockActionContext({
    startup: {
      userData: {
        getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
      } as unknown as UserData,
      workspaceManager: {
        openCourseExercises: vi.fn(async () => Ok.EMPTY),
        getExercisesByCourseSlug: () => openExerciseList,
      } as unknown as WorkspaceManager,
    },
  })
}

/** The open-exercise limit an open on this machine reports exceeded, if any. */
async function exceededLimitOn(
  totalRamBytes: number,
  openCount: number,
): Promise<number | undefined> {
  const openExercises = await openExercisesOnMachineWith(totalRamBytes)
  const actionContext = contextWithOpenExercises(openCount)
  const result = await openExercises(
    actionContext,
    [ExerciseIdentifier.from("mooc-ex-uuid-1")],
    CourseIdentifier.from("instance-uuid-1"),
  )
  // The entry point shows the warning; the operation only reports the limit.
  expect(actionContext.dialog.warningNotification).not.toHaveBeenCalled()
  return result.unwrap().exceededOpenLimit
}

suite("openExercises open-exercise-count limit", function () {
  afterEach(function () {
    vi.doUnmock("os")
    vi.resetModules()
  })

  test("is 50 open exercises on a machine with under 8 GiB of RAM", async function () {
    expect(await exceededLimitOn(4 * GIB, 51)).toBe(50)
    expect(await exceededLimitOn(4 * GIB, 50)).toBeUndefined()
  })

  test("is 100 open exercises on a machine with 8 GiB or more", async function () {
    expect(await exceededLimitOn(16 * GIB, 51)).toBeUndefined()
    expect(await exceededLimitOn(16 * GIB, 101)).toBe(100)
  })

  test("treats exactly 8 GiB as not weak", async function () {
    expect(await exceededLimitOn(8 * GIB, 51)).toBeUndefined()
  })
})

suite("downloadAndOpenExercises action", function () {
  // The local listing and the user's course catalogue agree on ids but not on
  // slugs: the same exercise is on disk as `mooc_hello_renamed`.
  const localListing = [
    {
      "course-slug": "mooc-python-course",
      "course-id": "instance-uuid-1",
      "exercise-slug": "mooc_hello_renamed",
      "exercise-id": "mooc-ex-uuid-1",
      "exercise-path": "/mooc/hello",
    },
  ]

  const contextFor = (listing: Result<typeof localListing, Error>): ReadyActionContext => {
    const workspaceManager = {
      openCourseExercises: vi.fn(async () => Ok.EMPTY),
      getExercisesByCourseSlug: () => [],
    } as unknown as WorkspaceManager
    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData
    const langs = {
      listLocalCourseExercises: vi.fn(async () => listing),
    } as unknown as Langs
    return createMockActionContext({ startup: { langs, userData, workspaceManager } })
  }

  test("does not re-download an exercise that is already on disk under another slug", async function () {
    await downloadAndOpenExercises(
      contextFor(Ok(localListing)),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).not.toHaveBeenCalled()
  })

  test("downloads an exercise the local listing does not report", async function () {
    await downloadAndOpenExercises(
      contextFor(Ok([])),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).toHaveBeenCalledWith(
      expect.anything(),
      "download",
      CourseIdentifier.from("instance-uuid-1"),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
    )
  })

  test("returns a failed local listing without reporting it", async function () {
    const error = new Error("tmc-langs crashed")
    const actionContext = contextFor(Err(error))

    const result = await downloadAndOpenExercises(
      actionContext,
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )

    expect(result.err && result.val).toBe(error)
    expect(actionContext.dialog.reportError).not.toHaveBeenCalled()
    expect(downloadExercisesForUi).not.toHaveBeenCalled()
  })
})
