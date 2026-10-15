import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { LocalCourseData } from "../../../shared/lib"
import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { addNewCourse } from "../../commands/addNewCourse"
import { downloadExercisesOfCourse } from "../../commands/downloadExercisesOfCourse"
import { MOOC_BACKEND_URL } from "../../config/constants"
import type { UserData } from "../../config/userdata"
import { openWebLink } from "../../utilities/webLink"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/addNewCourse", () => ({
  addNewCourse: vi.fn(async () => Ok.EMPTY),
}))
vi.mock("../../utilities/webLink", () => ({
  openWebLink: vi.fn(async () => true),
}))
vi.mock("../../commands/downloadExercisesOfCourse", () => ({
  downloadExercisesOfCourse: vi.fn(async () => {}),
}))

const organizations = [
  { name: "MOOC", slug: "mooc", information: "", logo_path: "", pinned: true },
  { name: "Test org", slug: "test", information: "", logo_path: "", pinned: false },
]

const tmcCourses = [
  {
    id: 1,
    name: "shared-slug",
    title: "Python Programming",
    description: null,
    details_url: "",
    unlock_url: "",
    reviews_url: "",
    comet_url: "",
    spyware_urls: [],
  },
]

const moocCourse = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Shared Slug Course",
  slug: "shared-slug",
  description: null,
  organization_name: "MOOC.fi",
}

type Item = vscode.QuickPickItem & { choice?: unknown }

/** The parts of `vscode.QuickPick` the command drives, with the user's side exposed. */
class FakeQuickPick {
  public title: string | undefined
  public placeholder: string | undefined
  public value = ""
  public busy = false
  public matchOnDescription = false
  public ignoreFocusOut = false
  public step: number | undefined
  public totalSteps: number | undefined
  public buttons: vscode.QuickInputButton[] = []
  public items: Item[] = []
  public selectedItems: Item[] = []
  public isShown = false
  public isDisposed = false
  private readonly _accept = new vscode.EventEmitter<void>()
  private readonly _hide = new vscode.EventEmitter<void>()
  private readonly _button = new vscode.EventEmitter<vscode.QuickInputButton>()
  public readonly onDidAccept = this._accept.event
  public readonly onDidHide = this._hide.event
  public readonly onDidTriggerButton = this._button.event

  public show(): void {
    this.isShown = true
  }

  public hide(): void {
    if (this.isShown) {
      this.isShown = false
      this._hide.fire()
    }
  }

  public dispose(): void {
    this.isDisposed = true
  }

  /** Labels of the rows, separators included and marked `---`. */
  public get rows(): string[] {
    return this.items.map((item) =>
      item.kind === vscode.QuickPickItemKind.Separator ? `--- ${item.label}` : item.label,
    )
  }

  public accept(label: string): void {
    const item = this.items.find((x) => x.label === label)
    if (!item) {
      throw new Error(`no row "${label}" in ${JSON.stringify(this.rows)}`)
    }
    this.selectedItems = [item]
    this._accept.fire()
  }

  public back(): void {
    this._button.fire(vscode.QuickInputButtons.Back)
  }
}

/** Lets the command's pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function harness(
  options: {
    organizations?: Promise<ReturnType<typeof Ok> | ReturnType<typeof Err>>
    moocCourses?: Promise<ReturnType<typeof Ok> | ReturnType<typeof Err>>
    moocAuthenticated?: boolean
    organizationCourses?: ReturnType<typeof Ok> | ReturnType<typeof Err>
    coursesOf?: (slug: string) => Promise<ReturnType<typeof Ok> | ReturnType<typeof Err>>
    addedCourses?: LocalCourseData[]
  } = {},
): { context: ReadyActionContext; quickPick: FakeQuickPick; done: Promise<void> } {
  const quickPick = new FakeQuickPick()
  vi.spyOn(vscode.window, "createQuickPick").mockReturnValue(quickPick as never)
  const langs = {
    getTmcOrganizations: vi.fn(() => options.organizations ?? Promise.resolve(Ok(organizations))),
    getEnrolledMoocCourses: vi.fn(() => options.moocCourses ?? Promise.resolve(Ok([moocCourse]))),
    getCourses: vi.fn(
      options.coursesOf ?? (async () => options.organizationCourses ?? Ok(tmcCourses)),
    ),
  } as unknown as Langs
  const userData = {
    getCourses: () => options.addedCourses ?? [],
  } as unknown as UserData
  const [dialog] = createDialogMock()
  const context = {
    ...createMockActionContext({
      loggedIn: options.moocAuthenticated ?? true,
      startup: { langs, userData },
    }),
    dialog,
  }
  return { context, quickPick, done: addNewCourse(context) }
}

suite("Add New Course command", function () {
  let executeCommand: ReturnType<typeof vi.spyOn>

  beforeEach(function () {
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.mocked(actions.addNewCourse).mockClear()
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("opens at once, busy, and searches descriptions too", function () {
    const { quickPick } = harness({ organizations: new Promise(() => {}) })

    expect(quickPick.isShown).toBe(true)
    expect(quickPick.busy).toBe(true)
    expect(quickPick.matchOnDescription).toBe(true)
    expect(quickPick.title).toBe("Add Course")
  })

  test("lists the user's mooc courses before the TMC organizations, under separators", async function () {
    const { quickPick } = harness()
    await flush()

    expect(quickPick.rows).toEqual([
      "--- courses.mooc.fi — your courses",
      "Shared Slug Course",
      "--- tmc.mooc.fi — organizations",
      "MOOC",
      "Test org",
    ])
    expect(quickPick.items[1]?.description).toBe("MOOC.fi")
    expect(quickPick.busy).toBe(false)
  })

  test("shows no rows until both backends have answered, so none moves under a click", async function () {
    const tmc = deferred<ReturnType<typeof Ok>>()
    const { quickPick } = harness({ organizations: tmc.promise })
    await flush()

    expect(quickPick.rows).toEqual([])
    expect(quickPick.busy).toBe(true)

    tmc.resolve(Ok(organizations))
    await flush()

    expect(quickPick.rows).toHaveLength(5)
    expect(quickPick.busy).toBe(false)
  })

  test("adds a mooc course in one step, with progress, and offers to open it", async function () {
    const { context, quickPick, done } = harness()
    await flush()

    quickPick.accept("Shared Slug Course")
    await done

    const courseId = makeMoocKind({ moocCourseId: moocCourse.id })
    expect(actions.addNewCourse).toHaveBeenCalledExactlyOnceWith(context, "", courseId)
    expect(context.dialog.progressNotification).toHaveBeenCalledWith(
      "Adding Shared Slug Course…",
      expect.any(Function),
      undefined,
    )
    const [message, [label, downloadAndOpen], [detailsLabel, details]] = vi.mocked(
      context.dialog.notification,
    ).mock.calls[0] as [string, [string, () => void], [string, () => void]]
    expect([message, label, detailsLabel]).toEqual([
      "Added Shared Slug Course.",
      "Download and Open Course",
      "Course Details",
    ])
    downloadAndOpen()
    await flush()
    expect(downloadExercisesOfCourse).toHaveBeenCalledExactlyOnceWith(
      context,
      courseId,
      "startingParts",
    )
    expect(executeCommand).toHaveBeenCalledWith("tmc.openCourseWorkspace", courseId)
    details()
    expect(executeCommand).toHaveBeenCalledWith("tmc.courseDetails", courseId)
    expect(quickPick.isDisposed).toBe(true)
  })

  test("adds a tmc course from its organization's step, which Back leaves", async function () {
    const { context, quickPick, done } = harness()
    await flush()

    quickPick.accept("Test org")
    await flush()
    expect(quickPick.step).toBe(2)
    expect(quickPick.totalSteps).toBe(2)
    expect(quickPick.buttons).toEqual([vscode.QuickInputButtons.Back])
    expect(quickPick.placeholder).toBe("Which course in Test org?")
    expect(quickPick.rows).toEqual(["Python Programming"])

    quickPick.back()
    expect(quickPick.step).toBeUndefined()
    expect(quickPick.rows).toHaveLength(5)

    quickPick.accept("Test org")
    await flush()
    quickPick.accept("Python Programming")
    await done

    expect(actions.addNewCourse).toHaveBeenCalledExactlyOnceWith(
      context,
      "test",
      makeTmcKind({ courseId: 1 }),
    )
  })

  test("keeps the user's filter text when a backend's rows arrive", async function () {
    const tmc = deferred<ReturnType<typeof Ok>>()
    const { quickPick } = harness({ organizations: tmc.promise })
    await flush()

    quickPick.value = "pyth"
    tmc.resolve(Ok(organizations))
    await flush()

    expect(quickPick.value).toBe("pyth")
    expect(quickPick.rows).toHaveLength(5)
  })

  test("ignores a late course listing for an organization the user backed out of", async function () {
    const mooc = deferred<ReturnType<typeof Ok>>()
    const test = deferred<ReturnType<typeof Ok>>()
    const otherCourse = { ...tmcCourses[0], id: 2, name: "other", title: "Other Course" }
    const { context, quickPick, done } = harness({
      coursesOf: (slug) => (slug === "mooc" ? mooc.promise : test.promise),
    })
    await flush()

    quickPick.accept("MOOC")
    await flush()
    quickPick.back()
    quickPick.accept("Test org")
    await flush()
    test.resolve(Ok(tmcCourses))
    await flush()
    mooc.resolve(Ok([otherCourse]))
    await flush()

    expect(quickPick.placeholder).toBe("Which course in Test org?")
    expect(quickPick.rows).toEqual(["Python Programming"])
    quickPick.accept("Python Programming")
    await done
    expect(actions.addNewCourse).toHaveBeenCalledExactlyOnceWith(
      context,
      "test",
      makeTmcKind({ courseId: 1 }),
    )
  })

  test("reuses an organization's course listing when the user goes back to it", async function () {
    const { context, quickPick } = harness()
    await flush()

    quickPick.accept("Test org")
    await flush()
    quickPick.back()
    quickPick.accept("Test org")
    await flush()

    expect(quickPick.rows).toEqual(["Python Programming"])
    expect(context.startup.langs.getCourses).toHaveBeenCalledOnce()
  })

  test("names an unreachable backend and still offers the other", async function () {
    const { quickPick } = harness({
      organizations: Promise.resolve(Err(new Error("tmc.mooc.fi down"))),
    })
    await flush()

    expect(quickPick.rows).toEqual(["--- courses.mooc.fi — your courses", "Shared Slug Course"])
    expect(quickPick.placeholder).toContain("tmc.mooc.fi unavailable")
  })

  test("offers the courses.mooc.fi login without a session, and adds nothing when picked", async function () {
    const { context, quickPick, done } = harness({ moocAuthenticated: false })
    await flush()

    expect(quickPick.rows[1]).toBe("Log in to courses.mooc.fi")
    expect(context.startup.langs.getEnrolledMoocCourses).not.toHaveBeenCalled()

    quickPick.accept("Log in to courses.mooc.fi")
    await done

    expect(executeCommand).toHaveBeenCalledWith("tmc.showMoocLogin")
    expect(actions.addNewCourse).not.toHaveBeenCalled()
  })

  test("reports an error and closes when both backends fail", async function () {
    const { context, quickPick, done } = harness({
      organizations: Promise.resolve(Err(new Error("down"))),
      moocCourses: Promise.resolve(Err(new Error("down"))),
    })
    await done

    expect(quickPick.isShown).toBe(false)
    expect(context.dialog.errorNotification).toHaveBeenCalledWith(
      "Failed to fetch courses from courses.mooc.fi or tmc.mooc.fi. " +
        "Check your network connection and that you are logged in.",
    )
  })

  test("without an enrolled course, offers to find one on courses.mooc.fi instead", async function () {
    const { context, quickPick, done } = harness({
      organizations: Promise.resolve(Ok([])),
      moocCourses: Promise.resolve(Ok([])),
    })
    await flush()

    expect(quickPick.isShown).toBe(true)
    expect(quickPick.rows).toEqual([
      "--- courses.mooc.fi — your courses",
      "Find a course on courses.mooc.fi",
    ])
    quickPick.accept("Find a course on courses.mooc.fi")
    await done

    expect(openWebLink).toHaveBeenCalledExactlyOnceWith(MOOC_BACKEND_URL)
    expect(context.dialog.notification).not.toHaveBeenCalled()
    expect(actions.addNewCourse).not.toHaveBeenCalled()
  })

  test("still lists the TMC organizations beside the way to find a course", async function () {
    const { quickPick } = harness({ moocCourses: Promise.resolve(Ok([])) })
    await flush()

    expect(quickPick.rows).toEqual([
      "--- courses.mooc.fi — your courses",
      "Find a course on courses.mooc.fi",
      "--- tmc.mooc.fi — organizations",
      "MOOC",
      "Test org",
    ])
  })

  test("marks courses already added, and opening one shows its details instead of re-adding", async function () {
    const added = [
      { kind: "mooc", data: { id: moocCourse.id } },
      { kind: "tmc", data: { id: 1 } },
    ] as LocalCourseData[]
    const { quickPick, done } = harness({ addedCourses: added })
    await flush()

    expect(quickPick.items[1]?.description).toBe("MOOC.fi · Already added")
    quickPick.accept("Test org")
    await flush()
    expect(quickPick.items[0]?.description).toBe("shared-slug · Already added")

    quickPick.accept("Python Programming")
    await done

    expect(actions.addNewCourse).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledWith("tmc.courseDetails", makeTmcKind({ courseId: 1 }))
  })

  test("adds nothing when dismissed", async function () {
    const { quickPick, done } = harness()
    await flush()

    quickPick.hide()
    await done

    expect(actions.addNewCourse).not.toHaveBeenCalled()
    expect(quickPick.isDisposed).toBe(true)
  })
})
