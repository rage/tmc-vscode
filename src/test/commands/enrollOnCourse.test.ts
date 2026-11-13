import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { CourseIdentifier, LocalCourseData } from "../../../shared/lib"
import { LocalCourseData as LocalCourseDataNs } from "../../../shared/lib"
import type { ReadyActionContext } from "../../actions/types"
import { enrollOnCourse } from "../../commands/enrollOnCourse"
import type { UserData } from "../../config/userdata"
import { moocCourseExercise, moocLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

const PAGE = "https://courses.mooc.fi/org/uh-cs/courses/python/chapter-1/loops"

function courseWithPage(id: string, notEnrolled: boolean): LocalCourseData {
  return moocLocalCourse({
    id,
    exercises: [moocCourseExercise({ pageUrl: PAGE.replace("python", id) })],
    ...(notEnrolled ? { notEnrolled: true } : {}),
  })
}

function contextWith(courses: LocalCourseData[]): ReadyActionContext {
  const [dialog] = createDialogMock()
  return {
    ...createMockActionContext({
      startup: {
        userData: {
          getCourses: () => courses,
          getCourse: (id: CourseIdentifier) => {
            const found = courses.find(
              (course) =>
                JSON.stringify(LocalCourseDataNs.getCourseId(course)) === JSON.stringify(id),
            )
            return found ? Ok(found) : Err(new Error("no such course"))
          },
        } as unknown as UserData,
      },
    }),
    dialog,
  }
}

suite("enrollOnCourse", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("opens the page of the one course courses.mooc.fi refused the student on", async function () {
    const openExternal = vi.fn(async () => true)
    const vscodeModule: object = vscode
    Object.defineProperty(vscodeModule, "env", { value: { openExternal }, configurable: true })

    await enrollOnCourse(
      contextWith([courseWithPage("enrolled", false), courseWithPage("refused", true)]),
    )

    expect(openExternal).toHaveBeenCalledOnce()
    expect(String((openExternal.mock.calls[0] as unknown[])[0])).toBe(
      "https://courses.mooc.fi/org/uh-cs/courses/refused",
    )
  })
})
