import { vi } from "vitest"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type {
  LocalCourseData,
  SharedMoocCourseData,
  SharedTmcCourseData,
  SharedTmcCourseExercise,
} from "../../shared/shared"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { downloadFailures } from "../../ui/downloadFailures"
import { exerciseOperations } from "../../ui/exerciseOperations"
import type { CoursesTreeItem, CoursesTreeSource } from "../../ui/treeview/treeview"
import CoursesTree, {
  CourseTreeItem,
  ExerciseTreeItem,
  exerciseItems,
  PartTreeItem,
} from "../../ui/treeview/treeview"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { moocLocalCourse, tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"

const NOW = new Date("2026-06-01T12:00:00Z")

// jest-mock-vscode ships no `env` namespace.
beforeAll(function () {
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", { value: { language: "en" }, configurable: true })
})

function tmcExercise(
  id: number,
  name: string,
  overrides: Partial<SharedTmcCourseExercise> = {},
): SharedTmcCourseExercise {
  return tmcCourseExercise({ id, name, ...overrides })
}

function tmcCourse(overrides: Partial<SharedTmcCourseData> = {}): LocalCourseData {
  return tmcLocalCourse({
    id: 1,
    name: "tmc-slug",
    title: "The Python Course",
    awardedPoints: 12,
    availablePoints: 40,
    ...overrides,
  })
}

function moocCourse(overrides: Partial<SharedMoocCourseData> = {}): LocalCourseData {
  return moocLocalCourse({
    id: "course-uuid",
    name: "mooc-slug",
    title: "Introduction to CS",
    ...overrides,
  })
}

function onDisk(exerciseSlug: string, status: ExerciseStatus): WorkspaceExercise {
  return {
    backend: "tmc",
    courseSlug: "tmc-slug",
    exerciseSlug,
    status,
    uri: vscode.Uri.file(`/exercises/tmc-slug/${exerciseSlug}`),
  }
}

function first<T>(items: T[]): T {
  const [item] = items
  if (item === undefined) {
    throw new Error("expected at least one item")
  }
  return item
}

function exercisesOf(course: CoursesTreeItem | undefined): ExerciseTreeItem[] {
  return course ? exerciseItems(course) : []
}

function icon(item: ExerciseTreeItem): [string, string | undefined] {
  // jest-mock-vscode keeps the colour as `themeColor`, VS Code as `color`.
  const themeIcon = item.iconPath as vscode.ThemeIcon & { themeColor?: vscode.ThemeColor }
  return [themeIcon.id, (themeIcon.color ?? themeIcon.themeColor)?.id]
}

/** Lets the view's delayed render, with its badge and change event, happen. */
function settle(): void {
  vi.advanceTimersByTime(1000)
}

interface FakeView {
  badge: vscode.ViewBadge | undefined
  message: string | undefined
  visible: boolean
  reveal: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  onDidChangeVisibility: vscode.Event<unknown>
}

suite("CoursesTree", function () {
  let tree: CoursesTree
  let view: FakeView
  let courses: LocalCourseData[]
  let workspaceExercises: WorkspaceExercise[]
  let exercisesChanged: vscode.EventEmitter<void>
  let coursesChanged: vscode.EventEmitter<void>
  let activeEditorChanged: vscode.EventEmitter<vscode.TextEditor | undefined>

  function source(): CoursesTreeSource {
    return {
      getCourses: () => courses,
      onDidChangeCourses: coursesChanged.event,
      workspaceManager: {
        activeCourse: undefined,
        activeCourseBackend: undefined,
        getExercises: () => workspaceExercises,
        getExerciseContaining: (uri: vscode.Uri) =>
          workspaceExercises.find((ex) => uri.fsPath.startsWith(ex.uri.fsPath)),
        onDidChangeExercises: exercisesChanged.event,
      },
    }
  }

  function show(...shown: LocalCourseData[]): CoursesTreeItem[] {
    courses = shown
    tree.setLoggedIn(true)
    tree.setSource(source())
    settle()
    return tree.getChildren()
  }

  function tooltipOf(item: CoursesTreeItem | undefined): string {
    return item ? (tree.resolveTreeItem(item, item).tooltip as vscode.MarkdownString).value : ""
  }

  beforeEach(function () {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] })
    courses = []
    workspaceExercises = []
    exercisesChanged = new vscode.EventEmitter<void>()
    coursesChanged = new vscode.EventEmitter<void>()
    activeEditorChanged = new vscode.EventEmitter<vscode.TextEditor | undefined>()
    view = {
      badge: undefined,
      message: undefined,
      visible: true,
      reveal: vi.fn(async () => undefined),
      dispose: vi.fn(),
      onDidChangeVisibility: new vscode.EventEmitter<unknown>().event,
    }
    // jest-mock-vscode's createTreeView returns nothing.
    vi.spyOn(vscode.window, "createTreeView").mockReturnValue(view as never)
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(
      activeEditorChanged.event,
    )
    downloadFailures.clear()
    updateablesRegistry.clear()
    tree = new CoursesTree()
  })

  afterEach(function () {
    tree.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // An empty view is what lets `viewsWelcome` explain why there is nothing in it.
  test("is empty until logged in, and until activation gives it courses", function () {
    courses = [tmcCourse()]
    expect(tree.getChildren()).toEqual([])
    tree.setLoggedIn(true)
    expect(tree.getChildren()).toEqual([])
    tree.setSource(source())
    expect(tree.getChildren()).toHaveLength(1)
    tree.setLoggedIn(false)
    expect(tree.getChildren()).toEqual([])
  })

  test("lists the courses as roots, read afresh on every refresh", function () {
    show(tmcCourse())
    courses.push(moocCourse())
    tree.refresh()

    expect(tree.getChildren().map((item) => item.label)).toEqual([
      "The Python Course",
      "Introduction to CS",
    ])
  })

  // A click expands the course, so Course Details is left to the context menu.
  test("a course item carries its points, backend and id, and no click command", function () {
    const item = first(show(tmcCourse())) as CourseTreeItem

    expect(item.description).toBe("12/40 · TMC Server")
    expect(item.accessibilityInformation?.label).toBe(
      "The Python Course, 12 of 40 points, TMC Server",
    )
    expect(item.contextValue).toBe("course.tmc")
    expect(item.courseId).toEqual(CourseIdentifier.from(1))
    expect(item.command).toBeUndefined()
    expect((item.iconPath as vscode.ThemeIcon).id).toBe("book")
  })

  // Same-titled courses exist on both backends; the backend tells them apart.
  test("a course without points still names its backend", function () {
    expect(show(moocCourse())[0]?.description).toBe("courses.mooc.fi")
  })

  test("a disabled course says so", function () {
    const item = first(show(tmcCourse({ disabled: true })))

    expect(item.description).toBe("12/40 · TMC Server · disabled")
    expect(tooltipOf(item)).toContain("disabled")
  })

  test("a course with new exercises is marked for the inline download action", function () {
    const item = first(show(moocCourse({ newExercises: ["a", "b"] })))

    expect(item.contextValue).toBe("course.mooc.hasNew")
    expect(tooltipOf(item)).toContain("2 new exercises")
  })

  test("a course with a passed exercise still open is marked for closing it", function () {
    workspaceExercises = [onDisk("part01-01_hello", ExerciseStatus.Open)]

    const [item] = show(
      tmcCourse({ exercises: [tmcExercise(1, "part01-01_hello", { passed: true })] }),
    )

    expect(item?.contextValue).toBe("course.tmc.hasCompleted")
  })

  test("a tmc course's exercises sit under its parts, named by number", function () {
    const [course] = show(
      tmcCourse({
        exercises: [
          tmcExercise(3, "part02-01_loops"),
          tmcExercise(1, "part01-01_hello", { passed: true }),
          tmcExercise(2, "part01-02_world"),
        ],
      }),
    )
    const parts = tree.getChildren(course)

    expect(parts.map((part) => [part.label, part.description])).toEqual([
      ["Part 1", "1/2 passed"],
      ["Part 2", "0/1 passed"],
    ])
    expect(tree.getChildren(parts[0]).map((item) => item.label)).toEqual(["01_hello", "02_world"])
    expect(tree.getParent(tree.getChildren(parts[0])[0] as CoursesTreeItem)).toBe(parts[0])
    expect(tree.getParent(parts[0] as CoursesTreeItem)).toBe(course)
  })

  test("a tmc course with one part so far still shows the part", function () {
    const [course] = show(tmcCourse({ exercises: [tmcExercise(1, "part01-01_hello")] }))

    expect(tree.getChildren(course).map((child) => child.label)).toEqual(["Part 1"])
  })

  test("a course whose exercises name no part lists them directly", function () {
    const [course] = show(
      moocCourse({
        exercises: [
          { ...tmcExercise(0, "python3_simple"), id: "ex-1" },
          { ...tmcExercise(0, "Hello world"), id: "ex-2" },
        ],
      }),
    )
    const children = tree.getChildren(course)

    expect(children.every((child) => child instanceof ExerciseTreeItem)).toBe(true)
    expect(children.map((child) => child.label)).toEqual(["python3_simple", "Hello world"])
    expect(tree.getParent(children[0] as CoursesTreeItem)).toBe(course)
  })

  test("a part names its next deadline, and withholds it while its backend is unreachable", function () {
    const course = tmcCourse({
      exercises: [
        tmcExercise(1, "part01-01_hello", { deadline: "2026-07-01T00:00:00Z" }),
        tmcExercise(2, "part02-01_loops"),
      ],
    })
    const [part] = tree.getChildren(show(course)[0])
    expect(part?.description).toMatch(/^0\/1 passed · next deadline /)

    tree.setBackendReachable("tmc", false)
    const [offlinePart] = tree.getChildren(tree.getChildren()[0])
    expect(offlinePart?.description).toBe("0/1 passed")
  })

  test("a part is marked for the bulk actions its exercises allow", function () {
    workspaceExercises = [onDisk("part01-02_world", ExerciseStatus.Closed)]
    const [course] = show(
      tmcCourse({
        exercises: [
          tmcExercise(1, "part01-01_hello"),
          tmcExercise(2, "part01-02_world"),
          tmcExercise(3, "part02-01_loops"),
        ],
      }),
    )

    expect(tree.getChildren(course)[0]?.contextValue).toBe("part.hasMissing.hasClosed")
  })

  suite("an exercise", function () {
    function onlyExercise(
      overrides: Record<string, unknown> = {},
      courseOverrides: Record<string, unknown> = {},
    ): ExerciseTreeItem {
      const [course] = show(
        tmcCourse({
          exercises: [tmcExercise(1, "part01-01_hello", overrides)],
          ...courseOverrides,
        }),
      )
      const [item] = exercisesOf(course)
      if (!item) {
        throw new Error("no exercise")
      }
      return item
    }

    test("not downloaded offers the download", function () {
      const item = onlyExercise()

      expect(icon(item)).toEqual(["cloud-download", "testing.iconUnset"])
      expect(item.contextValue).toBe("exercise.missing")
      expect(item.description).toBe("not downloaded · 0/1 points")
      expect(item.exerciseUri).toBeUndefined()
    })

    test("new is told apart from merely not downloaded", function () {
      const item = onlyExercise({}, { newExercises: [1] })

      expect(icon(item)).toEqual(["cloud-download", "testing.iconQueued"])
      expect(item.contextValue).toBe("exercise.new")
    })

    test("open and not passed carries its folder for the exercise commands", function () {
      workspaceExercises = [onDisk("part01-01_hello", ExerciseStatus.Open)]
      const item = onlyExercise()

      expect(icon(item)).toEqual(["circle-large-outline", "testing.iconUnset"])
      expect(item.contextValue).toBe("exercise.opened")
      expect(item.description).toBe("0/1 points")
      expect(item.exerciseUri?.toString()).toBe(
        vscode.Uri.file("/exercises/tmc-slug/part01-01_hello").toString(),
      )
    })

    test("passed shows the passed icon whatever its local state", function () {
      workspaceExercises = [onDisk("part01-01_hello", ExerciseStatus.Closed)]
      const item = onlyExercise({ passed: true, awardedPoints: 1 })

      expect(icon(item)).toEqual(["pass-filled", "testing.iconPassed"])
      expect(item.contextValue).toBe("exercise.closed.passed")
      expect(item.description).toBe("closed · 1/1 points")
    })

    test("downloading spins, and a failed download says so", function () {
      const exerciseId = makeTmcKind({ tmcExerciseId: 1 })
      const claim = exerciseOperations.claim([exerciseId], "downloading", 60_000).unwrap()
      expect(icon(onlyExercise())).toEqual(["sync~spin", undefined])

      claim.releaseAll()
      downloadFailures.record([exerciseId], [])
      const failed = onlyExercise()
      expect(icon(failed)).toEqual(["error", "testing.iconErrored"])
      expect(failed.contextValue).toBe("exercise.downloadFailed")
    })

    test("past its hard deadline and not downloaded is expired", function () {
      const item = onlyExercise({ deadline: "2026-05-01T00:00:00Z" })

      expect(icon(item)).toEqual(["lock", "disabledForeground"])
      expect(item.contextValue).toBe("exercise.expired")
    })

    test("names its upcoming deadline while not passed, and explains a soft one", function () {
      const item = onlyExercise({
        softDeadline: "2026-06-20T00:00:00Z",
        deadline: "2026-07-01T00:00:00Z",
      })

      expect(item.description).toMatch(/^not downloaded · 0\/1 points · due /)
      expect(item.tooltip).toBeUndefined()
      const tooltip = tooltipOf(item)
      expect(tooltip).toContain("Soft deadline: ")
      expect(tooltip).toContain("75%")
      expect(tooltip).toContain("Deadline: ")
    })

    test("is read to a screen reader with its status, points and deadline", function () {
      const item = onlyExercise({ deadline: "2026-07-01T00:00:00Z" })

      expect(item.accessibilityInformation?.label).toMatch(
        /^01_hello, not passed, not downloaded, 0 of 1 points, due /,
      )
    })

    test("with an update is marked, and the course and badge count it", function () {
      workspaceExercises = [onDisk("part01-01_hello", ExerciseStatus.Open)]
      updateablesRegistry.set(CourseIdentifier.from(1), [makeTmcKind({ tmcExerciseId: 1 })])
      const item = onlyExercise()

      expect(item.contextValue).toBe("exercise.opened.updateable")
      expect(item.description).toBe("update available · 0/1 points")
      expect(tree.getChildren()[0]?.contextValue).toBe("course.tmc.hasUpdates")
      settle()
      expect(view.badge).toEqual({ value: 1, tooltip: "1 exercise update" })
    })
  })

  test("the view badge counts the new exercises across courses", function () {
    show(tmcCourse({ newExercises: [7] }), moocCourse({ newExercises: ["a"] }))

    expect(view.badge).toEqual({ value: 2, tooltip: "2 new exercises" })

    tree.setLoggedIn(false)
    settle()
    expect(view.badge).toBeUndefined()
  })

  test("updates the badge when the stored courses change", function () {
    show(tmcCourse({ newExercises: [7] }))

    courses = [tmcCourse()]
    coursesChanged.fire()
    settle()

    expect(view.badge).toBeUndefined()
  })

  test("says which backend could not be reached, until it answers again", function () {
    show(tmcCourse())

    tree.setBackendReachable("tmc", false)
    settle()
    expect(view.message).toMatch(/^TMC Server could not be reached\./)

    tree.setBackendReachable("tmc", true)
    settle()
    expect(view.message).toBe("")
  })

  test("re-renders on each download status, change on disk and change to the courses", function () {
    show(tmcCourse())
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    const changes = [
      () => downloadFailures.record([makeTmcKind({ tmcExerciseId: 1 })], []),
      () => updateablesRegistry.set(CourseIdentifier.from(1), []),
      () => exercisesChanged.fire(),
      () => coursesChanged.fire(),
    ]

    for (const change of changes) {
      change()
      settle()
    }

    expect(refreshed).toEqual([undefined, undefined, undefined, undefined])
  })

  test("renders a burst of changes once", function () {
    show(tmcCourse())
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))

    const claim = exerciseOperations
      .claim([makeTmcKind({ tmcExerciseId: 1 })], "downloading", 60_000)
      .unwrap()
    for (let id = 1; id <= 20; id++) {
      downloadFailures.record([makeTmcKind({ tmcExerciseId: id })], [])
    }
    claim.releaseAll()
    expect(refreshed).toEqual([])
    settle()

    expect(refreshed).toEqual([undefined])
  })

  test("a hidden view keeps its badge current and repaints once shown", function () {
    const visibilityChanged = new vscode.EventEmitter<unknown>()
    view.onDidChangeVisibility = visibilityChanged.event
    tree.dispose()
    tree = new CoursesTree()
    show(tmcCourse())
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    view.visible = false

    courses = [tmcCourse({ newExercises: [7] })]
    coursesChanged.fire()
    settle()

    expect(view.badge).toEqual({ value: 1, tooltip: "1 new exercise" })
    expect(refreshed).toEqual([])
    view.visible = true
    visibilityChanged.fire(undefined)
    expect(refreshed).toEqual([undefined])
  })

  suite("revealing the active exercise", function () {
    function openEditorOn(fsPath: string): void {
      vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue({
        document: { uri: vscode.Uri.file(fsPath) },
      } as vscode.TextEditor)
      activeEditorChanged.fire(vscode.window.activeTextEditor)
    }

    beforeEach(function () {
      workspaceExercises = [onDisk("part01-01_hello", ExerciseStatus.Open)]
      show(tmcCourse({ exercises: [tmcExercise(1, "part01-01_hello")] }))
    })

    test("selects the exercise a newly active file belongs to, keeping focus in the editor", function () {
      openEditorOn("/exercises/tmc-slug/part01-01_hello/src/hello.py")

      expect(view.reveal).toHaveBeenCalledOnce()
      const [item, options] = view.reveal.mock.calls[0] as [ExerciseTreeItem, object]
      expect(item.label).toBe("01_hello")
      expect(options).toEqual({ select: true, focus: false })
    })

    test("selects the exercise already open when the view first fills", function () {
      vi.spyOn(vscode.window, "activeTextEditor", "get").mockReturnValue({
        document: { uri: vscode.Uri.file("/exercises/tmc-slug/part01-01_hello/src/hello.py") },
      } as vscode.TextEditor)

      tree.setSource(source())

      expect(view.reveal).toHaveBeenCalledOnce()
    })

    test("leaves a hidden view alone", function () {
      view.visible = false
      openEditorOn("/exercises/tmc-slug/part01-01_hello/src/hello.py")

      expect(view.reveal).not.toHaveBeenCalled()
    })

    test("ignores a file outside every exercise", function () {
      openEditorOn("/home/student/notes.txt")

      expect(view.reveal).not.toHaveBeenCalled()
    })

    test("on request, opens even a hidden view and focuses the exercise's row", async function () {
      view.visible = false

      const isRevealed = await tree.revealExercise(
        vscode.Uri.file("/exercises/tmc-slug/part01-01_hello/src/hello.py"),
      )

      expect(isRevealed).toBe(true)
      const [item, options] = view.reveal.mock.calls[0] as [ExerciseTreeItem, object]
      expect(item.label).toBe("01_hello")
      expect(options).toEqual({ select: true, focus: true })
    })

    test("on request, reports a file no row holds", async function () {
      expect(await tree.revealExercise(vscode.Uri.file("/home/student/notes.txt"))).toBe(false)
      expect(view.reveal).not.toHaveBeenCalled()
    })
  })

  test("a refresh re-renders the whole view", function () {
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    tree.refresh()
    settle()

    expect(refreshed).toEqual([undefined])
  })

  test("disposing releases the view and stops further refresh events", function () {
    const refreshed: unknown[] = []
    tree.onDidChangeTreeData((node) => refreshed.push(node))
    tree.dispose()
    tree.refresh()
    downloadFailures.clear()
    settle()

    expect(view.dispose).toHaveBeenCalledOnce()
    expect(refreshed).toEqual([])
  })

  test("part and course rows are the classes the commands test for", function () {
    const [course] = show(
      tmcCourse({ exercises: [tmcExercise(1, "part01-01_a"), tmcExercise(2, "part02-01_b")] }),
    )

    expect(course).toBeInstanceOf(CourseTreeItem)
    expect(tree.getChildren(course)[0]).toBeInstanceOf(PartTreeItem)
  })
})
