import { vi } from "vitest"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeMoocKind, makeTmcKind } from "../../shared/shared"
import CoursesTree, { CourseTreeItem } from "../../ui/treeview/treeview"

function tmcCourse(overrides: Record<string, unknown> = {}): LocalCourseData {
  return makeTmcKind({
    id: 1,
    name: "tmc-slug",
    title: "The Python Course",
    awardedPoints: 12,
    availablePoints: 40,
    newExercises: [],
    ...overrides,
  }) as unknown as LocalCourseData
}

function moocCourse(overrides: Record<string, unknown> = {}): LocalCourseData {
  return makeMoocKind({
    id: "course-uuid",
    name: "mooc-slug",
    title: "Introduction to CS",
    awardedPoints: 0,
    availablePoints: 0,
    newExercises: [],
    ...overrides,
  }) as unknown as LocalCourseData
}

suite("CoursesTree", function () {
  let tree: CoursesTree
  let view: { badge: vscode.ViewBadge | undefined; dispose: ReturnType<typeof vi.fn> }

  beforeEach(function () {
    view = { badge: undefined, dispose: vi.fn() }
    // jest-mock-vscode's createTreeView returns nothing.
    vi.spyOn(vscode.window, "createTreeView").mockReturnValue(view as never)
    tree = new CoursesTree()
  })

  afterEach(function () {
    tree.dispose()
    vi.restoreAllMocks()
  })

  // An empty view is what lets `viewsWelcome` explain why there is nothing in it.
  test("is empty until logged in, and until activation gives it courses", function () {
    expect(tree.getChildren()).toEqual([])
    tree.setLoggedIn(true)
    expect(tree.getChildren()).toEqual([])
    tree.setCourseSource(() => [tmcCourse()])
    expect(tree.getChildren()).toHaveLength(1)
    tree.setLoggedIn(false)
    expect(tree.getChildren()).toEqual([])
  })

  test("lists the courses as roots, read afresh on every render", function () {
    const courses = [tmcCourse()]
    tree.setLoggedIn(true)
    tree.setCourseSource(() => courses)
    courses.push(moocCourse())

    expect(tree.getChildren().map((item) => item.label)).toEqual([
      "The Python Course",
      "Introduction to CS",
    ])
  })

  test("a course item carries its points, backend, id and course details command", function () {
    const item = new CourseTreeItem(tmcCourse())

    expect(item.description).toBe("12/40 · TMC Server")
    expect(item.contextValue).toBe("course.tmc")
    expect(item.courseId).toEqual(CourseIdentifier.from(1))
    expect(item.command).toMatchObject({
      command: "tmc.courseDetails",
      arguments: [CourseIdentifier.from(1)],
    })
    expect((item.iconPath as vscode.ThemeIcon).id).toBe("book")
  })

  // Same-titled courses exist on both backends; the backend tells them apart.
  test("a course without points still names its backend", function () {
    expect(new CourseTreeItem(moocCourse()).description).toBe("courses.mooc.fi")
  })

  test("a course with new exercises is marked for the inline download action", function () {
    const item = new CourseTreeItem(moocCourse({ newExercises: ["a", "b"] }))

    expect(item.contextValue).toBe("course.mooc.hasNew")
    expect((item.tooltip as vscode.MarkdownString).value).toContain("2 new exercises")
  })

  test("the view badge counts the new exercises across courses", function () {
    tree.setLoggedIn(true)
    tree.setCourseSource(() => [
      tmcCourse({ newExercises: [7] }),
      moocCourse({ newExercises: ["a"] }),
    ])

    expect(view.badge).toEqual({ value: 2, tooltip: "2 new exercises" })

    tree.setLoggedIn(false)
    expect(view.badge).toBeUndefined()
  })

  test("a refresh re-renders the whole view", function () {
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    tree.refresh()

    expect(refreshed).toEqual([undefined])
  })

  test("disposing releases the view and stops further refresh events", function () {
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    tree.dispose()
    tree.refresh()

    expect(view.dispose).toHaveBeenCalledOnce()
    expect(refreshed).toEqual([])
  })
})
