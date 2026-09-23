import { Ok } from "ts-results"
import type { Mock } from "vitest"
import { vi } from "vitest"
import type * as vscode from "vscode"

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

function contextWithOpenExercises(openCount: number): {
  actionContext: ReadyActionContext
  warningNotification: Mock
} {
  const warningNotification = vi.fn()
  const openExerciseList = Array.from({ length: openCount }, (_unused, index) => ({
    backend: "mooc",
    courseSlug: "mooc-python-course",
    exerciseSlug: `mooc_hello_${index}`,
    status: ExerciseStatus.Open,
  }))
  return {
    actionContext: {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
          } as unknown as UserData,
          workspaceManager: {
            openCourseExercises: vi.fn(async () => Ok.EMPTY),
            getExercisesByCourseSlug: () => openExerciseList,
          } as unknown as WorkspaceManager,
        },
      }),
      dialog: { warningNotification } as unknown as ReadyActionContext["dialog"],
    },
    warningNotification,
  }
}

async function openOn(totalRamBytes: number, openCount: number): Promise<Mock> {
  const openExercises = await openExercisesOnMachineWith(totalRamBytes)
  const { actionContext, warningNotification } = contextWithOpenExercises(openCount)
  await openExercises(
    {} as vscode.ExtensionContext,
    actionContext,
    [ExerciseIdentifier.from("mooc-ex-uuid-1")],
    CourseIdentifier.from("instance-uuid-1"),
  )
  return warningNotification
}

suite("openExercises open-exercise-count warning", function () {
  afterEach(function () {
    vi.doUnmock("os")
    vi.resetModules()
  })

  test("warns above 50 open exercises on a machine with under 8 GiB of RAM", async function () {
    expect(await openOn(4 * GIB, 51)).toHaveBeenCalledOnce()
    expect(await openOn(4 * GIB, 50)).not.toHaveBeenCalled()
  })

  test("warns only above 100 open exercises on a machine with 8 GiB or more", async function () {
    expect(await openOn(16 * GIB, 51)).not.toHaveBeenCalled()
    expect(await openOn(16 * GIB, 101)).toHaveBeenCalledOnce()
  })

  test("treats exactly 8 GiB as not weak", async function () {
    expect(await openOn(8 * GIB, 51)).not.toHaveBeenCalled()
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

  const contextFor = (listing: typeof localListing): ReadyActionContext => {
    const workspaceManager = {
      openCourseExercises: vi.fn(async () => Ok.EMPTY),
      getExercisesByCourseSlug: () => [],
    } as unknown as WorkspaceManager
    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData
    const langs = {
      listLocalCourseExercises: vi.fn(async () => Ok(listing)),
    } as unknown as Langs
    return {
      ...createMockActionContext({ startup: { langs, userData, workspaceManager } }),
      dialog: { reportError: vi.fn() } as unknown as ReadyActionContext["dialog"],
    }
  }

  test("does not re-download an exercise that is already on disk under another slug", async function () {
    await downloadAndOpenExercises(
      {} as vscode.ExtensionContext,
      contextFor(localListing),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).not.toHaveBeenCalled()
  })

  test("downloads an exercise the local listing does not report", async function () {
    await downloadAndOpenExercises(
      {} as vscode.ExtensionContext,
      contextFor([]),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
      CourseIdentifier.from("instance-uuid-1"),
    )
    expect(downloadExercisesForUi).toHaveBeenCalledWith(
      expect.anything(),
      "",
      CourseIdentifier.from("instance-uuid-1"),
      [ExerciseIdentifier.from("mooc-ex-uuid-1")],
    )
  })
})
