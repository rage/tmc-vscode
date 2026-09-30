import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import type { LocalCourseData, LocalCourseExercise } from "../../shared/shared"
import { ExerciseIdentifier, makeMoocKind } from "../../shared/shared"
import { exerciseOperations } from "../../ui/exerciseOperations"
import type { ExerciseStatusSources } from "../../ui/statusBarExercise"
import { ExerciseStatusBarItem, showExerciseActions } from "../../ui/statusBarExercise"
import { exerciseHelloWorld } from "../fixtures/workspaceManager"
import type { FakeStatusBarItem } from "../mocks/statusBar"
import { fakeStatusBarItems, tooltipText } from "../mocks/statusBar"

function storedExercise(awardedPoints: number, availablePoints: number): LocalCourseExercise {
  return makeMoocKind({
    id: "exercise-uuid",
    name: exerciseHelloWorld.exerciseSlug,
    awardedPoints,
    availablePoints,
    deadline: null,
    softDeadline: null,
    passed: awardedPoints === availablePoints,
  }) as LocalCourseExercise
}

const STORED_ID = ExerciseIdentifier.from("exercise-uuid")

const course = makeMoocKind({ id: "course-uuid" }) as unknown as LocalCourseData

interface Harness {
  sources: ExerciseStatusSources
  active: { exercise: WorkspaceExercise | undefined }
  stored: { exercise: LocalCourseExercise | undefined }
  editorChanged: vscode.EventEmitter<void>
  coursesChanged: vscode.EventEmitter<void>
}

function harness(): Harness {
  const active = { exercise: exerciseHelloWorld as WorkspaceExercise | undefined }
  const stored = { exercise: storedExercise(1, 2) as LocalCourseExercise | undefined }
  const editorChanged = new vscode.EventEmitter<void>()
  const coursesChanged = new vscode.EventEmitter<void>()
  vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(
    editorChanged.event as never,
  )
  const sources: ExerciseStatusSources = {
    workspaceManager: {
      get activeExercise() {
        return active.exercise
      },
      getExerciseContaining: () => active.exercise,
      onDidChangeExercises: new vscode.EventEmitter<void>().event,
    },
    userData: {
      getExerciseByName: () => stored.exercise,
      getCourseBySlug: () => Ok(course),
      onDidChangeCourses: coursesChanged.event,
    },
    operations: exerciseOperations,
  }
  return { sources, active, stored, editorChanged, coursesChanged }
}

suite("ExerciseStatusBarItem", function () {
  let items: FakeStatusBarItem[]
  let created: ExerciseStatusBarItem[]

  function track(exerciseItem: ExerciseStatusBarItem): void {
    created.push(exerciseItem)
  }

  beforeEach(function () {
    items = fakeStatusBarItems()
    created = []
  })

  afterEach(function () {
    for (const exerciseItem of created) {
      exerciseItem.dispose()
    }
    vi.restoreAllMocks()
  })

  function itemOf(): FakeStatusBarItem {
    const [item] = items
    if (!item) {
      throw new Error("no status bar item was created")
    }
    return item
  }

  test("names the active exercise and its points, on the right", function () {
    const { sources } = harness()
    track(new ExerciseStatusBarItem(sources))
    const item = itemOf()

    expect(item.id).toBe("tmc.activeExercise")
    expect(item.alignment).toBe(vscode.StatusBarAlignment.Right)
    expect(item.name).toBe("TestMyCode Exercise")
    expect(item.command).toBe("tmc.showExerciseActions")
    expect(item.isShown).toBe(true)
    expect(item.text).toBe(`$(beaker) ${exerciseHelloWorld.exerciseSlug} · 1/2`)
    expect(item.accessibilityInformation?.label).toContain("1 of 2 points")
    expect(tooltipText(item)).toContain("1/2 points")
  })

  test("leaves the points out when the exercise has none", function () {
    const h = harness()
    h.stored.exercise = storedExercise(0, 0)
    track(new ExerciseStatusBarItem(h.sources))

    expect(itemOf().text).toBe(`$(beaker) ${exerciseHelloWorld.exerciseSlug}`)
  })

  test("hides on a file outside every exercise, and comes back", function () {
    const h = harness()
    track(new ExerciseStatusBarItem(h.sources))

    h.active.exercise = undefined
    h.editorChanged.fire()
    expect(itemOf().isShown).toBe(false)

    h.active.exercise = exerciseHelloWorld
    h.editorChanged.fire()
    expect(itemOf().isShown).toBe(true)
  })

  test("spins while the exercise is tested, then shows the points again", async function () {
    const h = harness()
    track(new ExerciseStatusBarItem(h.sources))
    let duringRun = ""

    await exerciseOperations.run(STORED_ID, "testing", 60_000, async () => {
      duringRun = itemOf().text
      return Ok.EMPTY
    })

    expect(duringRun).toBe(`$(sync~spin) Testing ${exerciseHelloWorld.exerciseSlug}…`)
    expect(itemOf().text).toContain("$(beaker)")
  })

  test("says it is submitting while a submission runs", async function () {
    const h = harness()
    track(new ExerciseStatusBarItem(h.sources))
    let label: string | undefined

    await exerciseOperations.run(STORED_ID, "submitting", 60_000, async () => {
      label = itemOf().accessibilityInformation?.label
      return Ok.EMPTY
    })

    expect(label).toContain("submitting")
  })

  test("picks up new points when the courses change", function () {
    const h = harness()
    track(new ExerciseStatusBarItem(h.sources))

    h.stored.exercise = storedExercise(2, 2)
    h.coursesChanged.fire()

    expect(itemOf().text).toContain("2/2")
    expect(tooltipText(itemOf())).toContain("passed")
  })

  test("stops listening when disposed", function () {
    const h = harness()
    const exerciseItem = new ExerciseStatusBarItem(h.sources)

    exerciseItem.dispose()
    h.stored.exercise = storedExercise(2, 2)
    h.coursesChanged.fire()

    expect(itemOf().isDisposed).toBe(true)
    expect(itemOf().text).toContain("1/2")
  })
})

/** The labels, without codicons, of the actions the pick offered. */
function offered(): string[] {
  const [actions] = vi.mocked(vscode.window.showQuickPick).mock.calls[0] as unknown as [
    { label: string; kind?: number }[],
  ]
  return actions
    .filter((x) => x.kind !== vscode.QuickPickItemKind.Separator)
    .map((x) => x.label.replace(/^\$\([\w-]+\) /, ""))
}

suite("showExerciseActions", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("offers every action while logged in, and runs the pick on the exercise", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (
      items: readonly { label: string }[],
    ) => items.find((x) => x.label.includes("Submit"))) as never)

    await showExerciseActions(harness().sources, true)

    expect(offered()).toEqual([
      "Run Tests",
      "Submit Solution",
      "Share via Paste",
      "Download Old Submission…",
      "Reset Exercise",
      "Reveal in Courses View",
    ])
    expect(executeCommand).toHaveBeenCalledWith("tmc.submitExercise", exerciseHelloWorld.uri)
  })

  test("reveals the exercise in the Courses view", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (
      items: readonly { label: string }[],
    ) => items.find((x) => x.label.includes("Courses View"))) as never)

    await showExerciseActions(harness().sources, true)

    expect(executeCommand).toHaveBeenCalledWith("tmc.revealInCoursesView", exerciseHelloWorld.uri)
  })

  test("logged out, offers only what runs locally", async function () {
    vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined)

    await showExerciseActions(harness().sources, false)

    expect(offered()).toEqual(["Run Tests"])
  })

  test("leaves the reveal out for a course that is not stored", async function () {
    vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined)
    const { sources } = harness()
    sources.userData.getCourseBySlug = () => Err(new Error("no such course"))

    await showExerciseActions(sources, true)

    expect(offered()).not.toContain("Reveal in Courses View")
  })

  test("shows nothing outside an exercise", async function () {
    const showQuickPick = vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined)
    const h = harness()
    h.active.exercise = undefined

    await showExerciseActions(h.sources, true)

    expect(showQuickPick).not.toHaveBeenCalled()
  })
})
