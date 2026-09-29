import { Ok } from "ts-results"
import { vi } from "vitest"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { removeCourse } from "../../commands/removeCourse"
import type { UserData } from "../../config/userdata"
import { CourseIdentifier, makeMoocKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({ removeCourse: vi.fn(async () => Ok.EMPTY) }))

const courseId = CourseIdentifier.from("course-uuid")
const course = makeMoocKind({ id: "course-uuid", name: "cs-intro", title: "Introduction to CS" })

function contextWith(confirmed: boolean): ReadyActionContext {
  const [dialog, values] = createDialogMock()
  values.confirmation = confirmed
  const userData = {
    getCourse: () => Ok(course),
  } as unknown as UserData
  return { ...createMockActionContext({ startup: { userData } }), dialog }
}

suite("Remove course command", function () {
  beforeEach(function () {
    vi.mocked(actions.removeCourse).mockClear()
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("asks in a modal naming the course, then removes it and says so", async function () {
    const context = contextWith(true)

    await removeCourse(context, courseId)

    expect(context.dialog.confirm).toHaveBeenCalledWith(
      "Remove Introduction to CS from your courses?",
      expect.objectContaining({ confirmLabel: "Remove Course" }),
    )
    expect(actions.removeCourse).toHaveBeenCalledExactlyOnceWith(context, courseId)
    expect(context.dialog.statusMessage).toHaveBeenCalledWith("Removed Introduction to CS.")
  })

  test("removes nothing when cancelled", async function () {
    const context = contextWith(false)

    await removeCourse(context, courseId)

    expect(actions.removeCourse).not.toHaveBeenCalled()
  })
})
