import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { ExerciseUpdateCheck } from "../../actions/checkForExerciseUpdates"
import type { ReadyActionContext } from "../../actions/types"
import { updateExercises } from "../../commands/updateExercises"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type { CourseIdentifier, ExerciseIdentifier, LocalCourseData } from "../../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
} from "../../shared/shared"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const checkForExerciseUpdates = vi.hoisted(() => vi.fn())
const downloadExerciseUpdates = vi.hoisted(() => vi.fn())

vi.mock("../../actions/checkForExerciseUpdates", () => ({ checkForExerciseUpdates }))
vi.mock("../../actions/downloadExerciseUpdates", () => ({ downloadExerciseUpdates }))

/** An outdated exercise as `checkForExerciseUpdates` reports it: a fresh id object per exercise. */
function outdated(
  courseId: number,
  exerciseId: number,
): {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
  exerciseName: string
} {
  return {
    courseId: CourseIdentifierNs.from(courseId),
    exerciseId: ExerciseIdentifierNs.from(exerciseId),
    exerciseName: `exercise-${exerciseId}`,
  }
}

function tmcCourse(id: number): LocalCourseData {
  return { kind: "tmc", data: { id } } as LocalCourseData
}

const moocCourse = { kind: "mooc", data: { id: "mooc-course" } } as LocalCourseData

/** A check that reached every backend. */
function checked(exercises: ExerciseUpdateCheck["outdated"]): ExerciseUpdateCheck {
  return { outdated: exercises, failures: [] }
}

function contextWith(
  automaticallyUpdate: boolean,
): [ReadyActionContext, ReturnType<typeof createDialogMock>[0], ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const setNewExerciseNotifyAfter = vi.fn(async () => Ok.EMPTY)
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourses: () => [tmcCourse(1), tmcCourse(2), moocCourse],
            getCourse: () => Ok({ data: { notifyAfter: 0, disabled: false } }),
            setNewExerciseNotifyAfter,
          } as unknown as UserData,
        },
      }),
      dialog,
      settings: {
        getAutomaticallyUpdateExercises: () => automaticallyUpdate,
      } as unknown as Settings,
    },
    dialog,
    setNewExerciseNotifyAfter,
  ]
}

suite("updateExercises command", function () {
  beforeEach(function () {
    checkForExerciseUpdates.mockReset()
    downloadExerciseUpdates.mockReset()
    updateablesRegistry.clear()
  })

  test("records what it found per course, keeping a failed backend's last answer", async function () {
    const staleMooc = [ExerciseIdentifierNs.from("mooc-exercise")]
    updateablesRegistry.set(CourseIdentifierNs.from(2), [ExerciseIdentifierNs.from(99)])
    updateablesRegistry.set(CourseIdentifierNs.from("mooc-course"), staleMooc)
    checkForExerciseUpdates.mockResolvedValue({
      outdated: [outdated(1, 10), outdated(1, 11)],
      failures: [{ backend: "mooc", error: new Error("offline") }],
    })
    const [actionContext] = contextWith(true)

    await updateExercises(actionContext, "silent")

    expect(updateablesRegistry.get(CourseIdentifierNs.from(1))).toEqual([
      ExerciseIdentifierNs.from(10),
      ExerciseIdentifierNs.from(11),
    ])
    expect(updateablesRegistry.get(CourseIdentifierNs.from(2))).toEqual([])
    expect(updateablesRegistry.get(CourseIdentifierNs.from("mooc-course"))).toEqual(staleMooc)
  })

  test("postpones the reminder once per course, not once per exercise", async function () {
    checkForExerciseUpdates.mockResolvedValue(
      checked([outdated(1, 10), outdated(1, 11), outdated(2, 20)]),
    )
    const [actionContext, dialog, setNewExerciseNotifyAfter] = contextWith(false)

    await updateExercises(actionContext, "loud")

    const remindMeLater = vi.mocked(dialog.notification).mock.calls[0]?.[2]
    remindMeLater?.[1]()

    await vi.waitFor(() => expect(setNewExerciseNotifyAfter).toHaveBeenCalledTimes(2))
    expect(
      setNewExerciseNotifyAfter.mock.calls.map(([id]) =>
        CourseIdentifierNs.toString(id as CourseIdentifier),
      ),
    ).toEqual(["1", "2"])
  })

  test("downloads the updates without asking when automatic updates are on", async function () {
    const updates = [outdated(1, 10), outdated(2, 20)]
    checkForExerciseUpdates.mockResolvedValue(checked(updates))
    const [actionContext, dialog] = contextWith(true)

    await updateExercises(actionContext, "loud")

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("downloads the updates the user accepts", async function () {
    const updates = [outdated(1, 10)]
    checkForExerciseUpdates.mockResolvedValue(checked(updates))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "loud")
    expect(downloadExerciseUpdates).not.toHaveBeenCalled()
    const download = vi.mocked(dialog.notification).mock.calls[0]?.[1]
    download?.[1]()

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates)
  })

  test("reports a failed check once when loud, and only logs it when silent", async function () {
    checkForExerciseUpdates.mockRejectedValue(new Error("offline"))
    const [loudContext, loudDialog] = contextWith(false)
    const [silentContext, silentDialog] = contextWith(false)

    await updateExercises(loudContext, "loud")
    await updateExercises(silentContext, "silent")

    expect(loudDialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check for exercise updates.",
      expect.objectContaining({ message: "offline" }),
      undefined,
    )
    expect(silentDialog.reportError).not.toHaveBeenCalled()
    expect(silentDialog.notification).not.toHaveBeenCalled()
  })

  test("reports a backend it could not check when loud, instead of the all-clear", async function () {
    const error = new Error("offline")
    checkForExerciseUpdates.mockResolvedValue({
      outdated: [],
      failures: [{ backend: "mooc", error }],
    })
    const [loudContext, loudDialog] = contextWith(false)
    const [silentContext, silentDialog] = contextWith(false)

    await updateExercises(loudContext, "loud")
    await updateExercises(silentContext, "silent")

    expect(loudDialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check courses.mooc.fi for exercise updates.",
      error,
      "mooc",
    )
    expect(loudDialog.notification).not.toHaveBeenCalled()
    expect(loudDialog.statusMessage).not.toHaveBeenCalled()
    expect(silentDialog.reportError).not.toHaveBeenCalled()
  })

  test("reports both backends failing in one notification", async function () {
    const tmcError = new Error("tmc offline")
    checkForExerciseUpdates.mockResolvedValue({
      outdated: [],
      failures: [
        { backend: "tmc", error: tmcError },
        { backend: "mooc", error: new Error("mooc offline") },
      ],
    })
    const [context, dialog] = contextWith(false)

    await updateExercises(context, "loud")

    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to check TMC Server and courses.mooc.fi for exercise updates.",
      tmcError,
      undefined,
    )
  })

  test("says in the status bar, not a notification, that everything is up to date", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([]))
    const [context, dialog] = contextWith(false)

    await updateExercises(context, "loud")

    expect(dialog.statusMessage).toHaveBeenCalledExactlyOnceWith("All exercises are up to date.")
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("still offers the updates in a silent run, but not the all-clear", async function () {
    checkForExerciseUpdates.mockResolvedValueOnce(checked([outdated(1, 10)]))
    checkForExerciseUpdates.mockResolvedValueOnce(checked([]))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "silent")
    await updateExercises(actionContext, "silent")

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "1 exercise has an update. Download it now?",
      expect.anything(),
      expect.anything(),
    )
  })

  test("reports a reminder that could not be postponed once", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10), outdated(2, 20)]))
    const [actionContext, dialog, setNewExerciseNotifyAfter] = contextWith(false)
    setNewExerciseNotifyAfter.mockResolvedValue(Err(new Error("storage full")))

    await updateExercises(actionContext, "silent")
    vi.mocked(dialog.notification).mock.calls[0]?.[2]?.[1]()

    await vi.waitFor(() =>
      expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(
        "Failed to postpone the reminder.",
        expect.objectContaining({ message: "storage full" }),
        undefined,
      ),
    )
    expect(setNewExerciseNotifyAfter).toHaveBeenCalledTimes(1)
  })
})
