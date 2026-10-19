import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyStartup } from "../../actions/types"
import type { NotificationButton } from "../../api/dialog"
import {
  createCourseWorkspaceOffer,
  withholdCourseWorkspaceOffer,
} from "../../commands/offerCourseWorkspace"
import { moocLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"

const course = moocLocalCourse({ id: "course-uuid", name: "python-course", title: "Python Course" })

function setup(): {
  offer: ReturnType<typeof createCourseWorkspaceOffer>
  shown: { message: string; buttons: NotificationButton[]; dismiss: () => void }[]
} {
  const shown: { message: string; buttons: NotificationButton[]; dismiss: () => void }[] = []
  const actionContext = createMockActionContext({
    startup: { userData: { getCourses: () => [course] } as unknown as ReadyStartup["userData"] },
  })
  vi.mocked(actionContext.dialog.notification).mockImplementation(
    (message: string, ...buttons: NotificationButton[]) =>
      new Promise<void>((resolve) => {
        shown.push({ message, buttons, dismiss: resolve })
      }),
  )
  return { offer: createCourseWorkspaceOffer(actionContext), shown }
}

suite("createCourseWorkspaceOffer", function () {
  beforeEach(function () {
    vi.useFakeTimers()
  })

  afterEach(function () {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("names the course and opens its workspace on request", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const { offer, shown } = setup()

    offer({ backend: "mooc", courseSlug: "python-course" })
    vi.runAllTimers()

    expect(shown.map((x) => x.message)).toEqual([
      "The exercises of Python Course open in its course workspace.",
    ])
    const [label, open] = shown[0]?.buttons[0] ?? []
    expect(label).toBe("Open Course Workspace")
    open?.()
    expect(executeCommand).toHaveBeenCalledWith(
      "tmc.openCourseWorkspace",
      expect.objectContaining({ kind: "mooc" }),
    )
  })

  test("asks once while the question is up, and again after it is answered", async function () {
    const { offer, shown } = setup()

    offer({ backend: "mooc", courseSlug: "python-course" })
    offer({ backend: "mooc", courseSlug: "python-course" })
    vi.runAllTimers()
    expect(shown).toHaveLength(1)

    shown[0]?.dismiss()
    await vi.runAllTimersAsync()
    offer({ backend: "mooc", courseSlug: "python-course" })
    vi.runAllTimers()
    expect(shown).toHaveLength(2)
  })

  test("says nothing about a course that is not stored", function () {
    const { offer, shown } = setup()

    offer({ backend: "tmc", courseSlug: "python-course" })
    vi.runAllTimers()

    expect(shown).toEqual([])
  })

  // e.g. "Download and Open Course", which opens the workspace right after the download.
  test("says nothing for a course whose workspace the student is opening anyway", function () {
    const { offer, shown } = setup()

    offer({ backend: "mooc", courseSlug: "python-course" })
    withholdCourseWorkspaceOffer({ backend: "mooc", courseSlug: "python-course" })
    vi.runAllTimers()

    expect(shown).toEqual([])
  })
})
