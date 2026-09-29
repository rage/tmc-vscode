import { vi } from "vitest"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../shared/shared"
import { trackHasCourses } from "../../ui/hasCoursesContext"

suite("trackHasCourses", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("sets the key from the stored courses, and on each change it makes", function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    let courses: LocalCourseData[] = []
    const changed = new vscode.EventEmitter<void>()

    trackHasCourses({ getCourses: () => courses }, changed.event)
    changed.fire()
    courses = [{} as LocalCourseData]
    changed.fire()
    changed.fire()
    courses = []
    changed.fire()

    const updates = executeCommand.mock.calls
      .filter(([command, key]) => command === "setContext" && key === "test-my-code:HasCourses")
      .map(([, , value]) => value)
    expect(updates).toEqual([false, true, false])
  })
})
