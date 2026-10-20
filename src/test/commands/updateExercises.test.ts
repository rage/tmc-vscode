import { Ok } from "ts-results"
import { onTestFinished, vi } from "vitest"
import * as vscode from "vscode"

import type { CourseIdentifier, ExerciseIdentifier, LocalCourseData } from "../../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../../shared/lib"
import type { ExerciseUpdateCheck } from "../../actions/checkForExerciseUpdates"
import type { ReadyActionContext } from "../../actions/types"
import { updateExercises } from "../../commands/updateExercises"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import { recentUpdates } from "../../ui/recentUpdates"
import { shownCourseHome } from "../../ui/shownCourseHome"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"
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
    courseId: idOfTmcCourse(courseId),
    exerciseId: idOfTmcExercise(exerciseId),
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
            getCourse: (id: CourseIdentifier) =>
              Ok({
                kind: "tmc",
                data: {
                  notifyAfter: 0,
                  disabled: false,
                  title: `Course ${CourseIdentifierNs.toString(id)}`,
                },
              }),
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
    downloadExerciseUpdates.mockReset().mockResolvedValue(Ok({ updated: [], warnings: [] }))
    updateablesRegistry.clear()
  })

  test("records what it found per course, keeping a failed backend's last answer", async function () {
    const staleMooc = [idOfMoocExercise("mooc-exercise")]
    updateablesRegistry.setMany([[idOfTmcCourse(2), [idOfTmcExercise(99)]]])
    updateablesRegistry.setMany([[idOfMoocCourse("mooc-course"), staleMooc]])
    checkForExerciseUpdates.mockResolvedValue({
      outdated: [outdated(1, 10), outdated(1, 11)],
      failures: [{ backend: "mooc", error: new Error("offline") }],
    })
    const [actionContext] = contextWith(true)

    await updateExercises(actionContext, "silent")

    expect(updateablesRegistry.get(idOfTmcCourse(1))).toEqual([
      idOfTmcExercise(10),
      idOfTmcExercise(11),
    ])
    expect(updateablesRegistry.get(idOfTmcCourse(2))).toEqual([])
    expect(updateablesRegistry.get(idOfMoocCourse("mooc-course"))).toEqual(staleMooc)
  })

  test("does not credit a tmc course's updates to a mooc course with the same id", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
    const [actionContext] = contextWith(true)
    const userData = actionContext.startup.userData
    vi.spyOn(userData, "getCourses").mockReturnValue([
      tmcCourse(1),
      { kind: "mooc", data: { id: "1" } } as LocalCourseData,
    ])

    await updateExercises(actionContext, "silent")

    expect(updateablesRegistry.get(idOfTmcCourse(1))).toEqual([idOfTmcExercise(10)])
    expect(updateablesRegistry.get(idOfMoocCourse("1"))).toEqual([])
  })

  suite("with the reminder postponed", function () {
    function postponed(automaticallyUpdate: boolean): ReturnType<typeof contextWith> {
      const context = contextWith(automaticallyUpdate)
      context[0].startup.userData.getCourse = () =>
        Ok({
          kind: "tmc",
          data: { notifyAfter: Date.now() + 60_000, disabled: false, title: "Course" },
        } as LocalCourseData)
      return context
    }

    test("still downloads the updates when automatic updates are on", async function () {
      const updates = [outdated(1, 10)]
      checkForExerciseUpdates.mockResolvedValue(checked(updates))
      const [actionContext] = postponed(true)

      await updateExercises(actionContext, "silent")

      expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates, true)
    })

    test("does not prompt on a run the user did not ask for", async function () {
      checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
      const [actionContext, dialog] = postponed(false)

      await updateExercises(actionContext, "silent")

      expect(dialog.notification).not.toHaveBeenCalled()
    })

    test("prompts when the user asks for the updates", async function () {
      checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
      const [actionContext, dialog] = postponed(false)

      await updateExercises(actionContext, "loud")

      expect(dialog.notification).toHaveBeenCalledOnce()
    })
  })

  test("downloads the updates without asking when automatic updates are on", async function () {
    const updates = [outdated(1, 10), outdated(2, 20)]
    checkForExerciseUpdates.mockResolvedValue(checked(updates))
    const [actionContext, dialog] = contextWith(true)

    await updateExercises(actionContext, "loud")

    expect(downloadExerciseUpdates).toHaveBeenCalledExactlyOnceWith(actionContext, updates, false)
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("asks the backends afresh when the user asked, and accepts a cached answer otherwise", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([]))
    const [actionContext] = contextWith(true)

    await updateExercises(actionContext, "loud")
    await updateExercises(actionContext, "silent")

    expect(checkForExerciseUpdates.mock.calls.map(([, options]) => options)).toEqual([
      { forceRefresh: true },
      { forceRefresh: false },
    ])
  })

  test("offers to show the course with the updates, and downloads nothing itself", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10), outdated(1, 11)]))
    const [actionContext, dialog] = contextWith(false)
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await updateExercises(actionContext, "loud")
    const [message, show] = vi.mocked(dialog.notification).mock.calls[0] ?? []
    show?.[1]()

    expect(message).toBe("2 exercises of Course 1 have updates.")
    expect(show?.[0]).toBe("Show")
    expect(executeCommand).toHaveBeenCalledWith("tmc.courseDetails", idOfTmcCourse(1))
    expect(downloadExerciseUpdates).not.toHaveBeenCalled()
  })

  test("offers nothing while the course home shows a course with updates", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
    const [actionContext, dialog] = contextWith(false)
    shownCourseHome.set(idOfTmcCourse(1))
    onTestFinished(() => shownCourseHome.set(undefined))

    await updateExercises(actionContext, "loud")

    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("an automatic update leaves a trace in the course home and offers to show it", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
    downloadExerciseUpdates.mockResolvedValue(Ok({ updated: [idOfTmcExercise(10)], warnings: [] }))
    const [actionContext, dialog] = contextWith(true)
    Object.assign(actionContext.startup.userData, {
      getExercise: () => Ok({ exercise: { kind: "tmc", data: { name: "loops" } } }),
    })
    onTestFinished(() => recentUpdates.dismiss(idOfTmcCourse(1)))

    await updateExercises(actionContext, "silent")

    expect(recentUpdates.get(idOfTmcCourse(1))).toEqual(["loops"])
    expect(dialog.statusMessage).not.toHaveBeenCalled()
    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Updated the exercise loops to the latest version.",
      ["Show", expect.any(Function)],
    )
  })

  test("an automatic update of the course on screen leaves only the trace", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([outdated(1, 10)]))
    downloadExerciseUpdates.mockResolvedValue(Ok({ updated: [idOfTmcExercise(10)], warnings: [] }))
    const [actionContext, dialog] = contextWith(true)
    Object.assign(actionContext.startup.userData, {
      getExercise: () => Ok({ exercise: { kind: "tmc", data: { name: "loops" } } }),
    })
    shownCourseHome.set(idOfTmcCourse(1))
    onTestFinished(() => {
      shownCourseHome.set(undefined)
      recentUpdates.dismiss(idOfTmcCourse(1))
    })

    await updateExercises(actionContext, "silent")

    expect(recentUpdates.get(idOfTmcCourse(1))).toEqual(["loops"])
    expect(dialog.notification).not.toHaveBeenCalled()
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
      "Failed to check tmc.mooc.fi and courses.mooc.fi for exercise updates.",
      tmcError,
    )
  })

  test("says in the status bar, not a notification, that everything is up to date", async function () {
    checkForExerciseUpdates.mockResolvedValue(checked([]))
    const [context, dialog] = contextWith(false)

    await updateExercises(context, "loud")

    expect(dialog.statusMessage).toHaveBeenCalledExactlyOnceWith("All exercises are up to date.")
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("offers an update once in silent runs, and never the all-clear", async function () {
    checkForExerciseUpdates.mockResolvedValueOnce(checked([outdated(1, 10)]))
    checkForExerciseUpdates.mockResolvedValueOnce(checked([outdated(1, 10)]))
    checkForExerciseUpdates.mockResolvedValueOnce(checked([]))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "silent")
    await updateExercises(actionContext, "silent")
    await updateExercises(actionContext, "silent")

    expect(dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "1 exercise of Course 1 has an update.",
      ["Show", expect.any(Function)],
    )
  })

  test("a promptless run offers nothing, but still records what it found", async function () {
    checkForExerciseUpdates.mockResolvedValueOnce(checked([outdated(1, 10)]))
    const [actionContext, dialog] = contextWith(false)

    await updateExercises(actionContext, "promptless")

    expect(dialog.notification).not.toHaveBeenCalled()
    expect(updateablesRegistry.get(idOfTmcCourse(1))).toHaveLength(1)
  })
})
