import { compact } from "lodash"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadCourseExercises } from "../../actions/downloadCourseExercises"
import { downloadAndOpenExercises } from "../../actions/openExercises"
import type { ReadyActionContext } from "../../actions/types"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { BottleneckError } from "../../errors"
import type { LocalCourseData } from "../../shared/shared"
import { ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import type { MoocLocalCourseData } from "../../storage/data"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/downloadCourseExercises", () => ({
  downloadCourseExercises: vi.fn(async () => Ok([])),
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
    },
  ],
  availablePoints: 1,
  awardedPoints: 0,
  newExercises: [],
  notifyAfter: 0,
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
        openCourseExercises: vi.fn(async () => Ok(openExerciseList)),
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
    [idOfMoocExercise("mooc-ex-uuid-1")],
    idOfMoocCourse("instance-uuid-1"),
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
  const MOOC_ID = idOfMoocExercise("mooc-ex-uuid-1")
  const COURSE_ID = idOfMoocCourse("instance-uuid-1")

  /** The exercise on disk under a slug the stored name does not give. */
  const renamedOnDisk = {
    id: MOOC_ID,
    courseId: COURSE_ID,
    backend: "mooc",
    courseSlug: "mooc-python-course",
    exerciseSlug: "mooc_hello_renamed",
    status: ExerciseStatus.Closed,
  } as WorkspaceExercise

  const contextFor = (onDisk: WorkspaceExercise[] = []): ReadyActionContext => {
    const onDiskById = new Map(onDisk.map((x) => [ExerciseIdentifier.key(x.id), x]))
    const workspaceManager = {
      openCourseExercises: vi.fn(
        async (_backend: string, _course: string, ids: ExerciseIdentifier[]) =>
          Ok(compact(ids.map((id) => onDiskById.get(ExerciseIdentifier.key(id))))),
      ),
      getExercise: (id: ExerciseIdentifier) => onDiskById.get(ExerciseIdentifier.key(id)),
      getExercisesByCourseSlug: () => [],
    } as unknown as WorkspaceManager
    const userData = {
      getCourse: () => Ok(makeMoocKind(moocCourse) as LocalCourseData),
    } as unknown as UserData
    return createMockActionContext({ startup: { userData, workspaceManager } })
  }

  test("does not re-download an exercise that is already on disk under another slug", async function () {
    const result = await downloadAndOpenExercises(contextFor([renamedOnDisk]), [MOOC_ID], COURSE_ID)

    expect(downloadCourseExercises).not.toHaveBeenCalled()
    expect(result.unwrap().ids).toEqual([MOOC_ID])
  })

  test("downloads an exercise that is not on disk", async function () {
    await downloadAndOpenExercises(contextFor(), [MOOC_ID], COURSE_ID)

    expect(downloadCourseExercises).toHaveBeenCalledWith(expect.anything(), COURSE_ID, [MOOC_ID])
  })

  test("downloads nothing for an id the course does not hold", async function () {
    await downloadAndOpenExercises(contextFor(), [idOfMoocExercise("elsewhere")], COURSE_ID)

    expect(downloadCourseExercises).not.toHaveBeenCalled()
  })

  test("reports only the exercises on disk as opened when a download fails", async function () {
    const course = makeMoocKind({
      ...moocCourse,
      exercises: [
        ...moocCourse.exercises,
        {
          id: "mooc-ex-uuid-2",
          name: "mooc_loops",
          availablePoints: 1,
          awardedPoints: 0,
          deadline: null,
          passed: false,
        },
      ],
    }) as LocalCourseData
    const actionContext = contextFor([renamedOnDisk])
    actionContext.startup.userData = { getCourse: () => Ok(course) } as unknown as UserData

    const result = await downloadAndOpenExercises(
      actionContext,
      [MOOC_ID, idOfMoocExercise("mooc-ex-uuid-2")],
      COURSE_ID,
    )

    expect(result.unwrap().ids).toEqual([MOOC_ID])
  })

  test("opens nothing while an exercise it would download is already downloading", async function () {
    const busy = new BottleneckError("Some of these exercises are already downloading.")
    vi.mocked(downloadCourseExercises).mockResolvedValueOnce(Err(busy))
    const actionContext = contextFor()

    const result = await downloadAndOpenExercises(actionContext, [MOOC_ID], COURSE_ID)

    expect(result.err && result.val).toBe(busy)
    expect(actionContext.startup.workspaceManager.openCourseExercises).not.toHaveBeenCalled()
  })
})
