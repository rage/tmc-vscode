import { vi } from "vitest"
import * as vscode from "vscode"

import Dialog, { courseSelectionItems } from "../../api/dialog"
import type {
  LocalCourseData,
  SharedMoocCourseData,
  SharedTmcCourseData,
} from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import { Logger } from "../../utilities"

suite("Dialog.selectItem", function () {
  let showQuickPick: ReturnType<typeof vi.spyOn>

  function stubPick(choose: (picks: vscode.QuickPickItem[]) => unknown): void {
    showQuickPick = vi
      .spyOn(vscode.window, "showQuickPick")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((async (items: vscode.QuickPickItem[]) => choose(items)) as any)
  }

  afterEach(function () {
    showQuickPick.mockRestore()
  })

  test("passes the optional third tuple element through as the item description", async function () {
    stubPick(() => undefined)
    await new Dialog().selectItem(
      { title: "Add New Course", placeHolder: "Which course?" },
      ["Programming 1", "a", "TMC Server"],
      ["Programming 1", "b", "courses.mooc.fi"],
      ["No description", "c"],
    )

    expect(showQuickPick.mock.calls[0]?.[0]).toEqual([
      { label: "Programming 1", value: "a", description: "TMC Server" },
      { label: "Programming 1", value: "b", description: "courses.mooc.fi" },
      { label: "No description", value: "c" },
    ])
    expect(showQuickPick.mock.calls[0]?.[1]).toEqual({
      title: "Add New Course",
      placeHolder: "Which course?",
    })
  })

  test("resolves duplicate labels by the picked item, not by label equality", async function () {
    // Two courses can share a slug across backends; picking the second must not
    // silently yield the first.
    stubPick((items) => items[1])
    const picked = await new Dialog().selectItem(
      "Which course?",
      ["shared-slug", "tmc-course", "TMC Server"],
      ["shared-slug", "mooc-course", "courses.mooc.fi"],
    )
    expect(picked).toBe("mooc-course")
  })

  test("returns undefined when the pick is dismissed", async function () {
    stubPick(() => undefined)
    expect(await new Dialog().selectItem("Which course?", ["a", 1])).toBeUndefined()
  })
})

suite("Dialog.progressNotification", function () {
  let reports: { message?: string; increment?: number }[]

  beforeEach(function () {
    reports = []
    vi.spyOn(vscode.window, "withProgress").mockImplementation((async (
      _options: unknown,
      task: (
        progress: { report: (value: { message?: string; increment?: number }) => void },
        token: vscode.CancellationToken,
      ) => Promise<unknown>,
    ) =>
      task({ report: (value): void => void reports.push(value) }, {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: (): void => {} }),
      } as unknown as vscode.CancellationToken)) as unknown as typeof vscode.window.withProgress)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("delivers a message reported at an unchanged fraction", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ message: "Fetching exercise 1", fraction: 0.5 })
      progress.report({ message: "Fetching exercise 2", fraction: 0.5 })
    })

    expect(reports).toEqual([
      { message: "Downloading", increment: 0 },
      { message: "Fetching exercise 1", increment: 50 },
      { message: "Fetching exercise 2", increment: 0 },
    ])
  })

  test("keeps the bar from moving backwards when the fraction drops", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ message: "Exercise 1 done", fraction: 0.6 })
      progress.report({ message: "Restarting exercise 2", fraction: 0.2 })
      progress.report({ message: "Exercise 2 done", fraction: 0.8 })
    })

    const increments = reports.map((report) => report.increment)
    expect(increments.slice(0, 3)).toEqual([0, 60, 0])
    expect(increments[3]).toBeCloseTo(20)
    expect(reports.at(-2)?.message).toBe("Restarting exercise 2")
  })

  test("drops a report that neither advances the bar nor carries a message", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ fraction: 0.4 })
      progress.report({ fraction: 0.4 })
    })

    expect(reports).toEqual([{ message: "Downloading", increment: 0 }, { increment: 40 }])
  })
})

type MessageAction = vscode.MessageItem & { callback: () => void }

type NotificationButton = [label: string, callback: () => void]

const notificationWrappers = [
  {
    name: "errorNotification",
    showMethod: "showErrorMessage",
    notify: (dialog: Dialog, message: string, ...buttons: NotificationButton[]): Promise<void> =>
      dialog.errorNotification(message, undefined, ...buttons),
  },
  {
    name: "notification",
    showMethod: "showInformationMessage",
    notify: (dialog: Dialog, message: string, ...buttons: NotificationButton[]): Promise<void> =>
      dialog.notification(message, ...buttons),
  },
  {
    name: "warningNotification",
    showMethod: "showWarningMessage",
    notify: (dialog: Dialog, message: string, ...buttons: NotificationButton[]): Promise<void> =>
      dialog.warningNotification(message, ...buttons),
  },
] as const

function stubMessage(
  showMethod: (typeof notificationWrappers)[number]["showMethod"],
  press: (actions: MessageAction[]) => MessageAction | undefined,
): ReturnType<typeof vi.spyOn> {
  const show = vi
    .spyOn(vscode.window, showMethod)
    .mockImplementation((async (_message: string, ...actions: MessageAction[]) =>
      press(actions)) as never)
  // The shared vscode mock's members are already `vi.fn()`s, so spying returns
  // the same mock and its calls outlive `restoreAllMocks`.
  show.mockClear()
  return show
}

function buttonTitles(show: ReturnType<typeof vi.spyOn>): string[] {
  const actions = (show.mock.calls[0] ?? []).slice(1) as MessageAction[]
  return actions.map((action) => action.title)
}

for (const { name, showMethod, notify } of notificationWrappers) {
  suite(`Dialog.${name}`, function () {
    afterEach(function () {
      vi.restoreAllMocks()
    })

    test("runs the callback of the button pressed, not of an earlier one sharing its label", async function () {
      stubMessage(showMethod, (actions) => actions[1])
      const pressed: string[] = []
      await notify(
        new Dialog(),
        "Two courses are named the same",
        ["Open", (): void => void pressed.push("first")],
        ["Open", (): void => void pressed.push("second")],
      )

      expect(pressed).toEqual(["second"])
    })

    test("prefixes the message and offers one button per item", async function () {
      const show = stubMessage(showMethod, () => undefined)
      await notify(new Dialog(), "Exercise downloaded", ["Open", (): void => {}])

      expect(show.mock.calls[0]?.[0]).toBe("TestMyCode: Exercise downloaded")
      expect(buttonTitles(show)).toEqual(["Open"])
    })

    test("runs no callback when the notification is dismissed", async function () {
      stubMessage(showMethod, () => undefined)
      let ran = false
      await notify(new Dialog(), "Exercise downloaded", [
        "Open",
        (): void => {
          ran = true
        },
      ])

      expect(ran).toBe(false)
    })
  })
}

suite("Dialog.errorNotification with an error", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("offers the logs alongside the caller's own buttons and reveals them when pressed", async function () {
    const showLogs = vi.spyOn(Logger, "show").mockImplementation(() => {})
    const logError = vi.spyOn(Logger, "error").mockImplementation(() => {})
    const show = stubMessage("showErrorMessage", (actions) => actions.at(-1))
    const boom = new Error("boom")
    await new Dialog().errorNotification("Download failed", boom, ["Retry", (): void => {}])

    expect(logError).toHaveBeenCalledWith("Download failed", boom)
    expect(buttonTitles(show)).toEqual(["Retry", "Show logs"])
    expect(showLogs).toHaveBeenCalledOnce()
  })

  test("without an error, neither logs nor offers the logs button", async function () {
    const logError = vi.spyOn(Logger, "error").mockImplementation(() => {})
    const show = stubMessage("showErrorMessage", () => undefined)
    await new Dialog().errorNotification("Download failed")

    expect(logError).not.toHaveBeenCalled()
    expect(buttonTitles(show)).toEqual([])
  })
})

function tmcCourse(id: number, name: string, title: string): LocalCourseData {
  return makeTmcKind({ id, name, title } as SharedTmcCourseData)
}

function moocCourse(id: string, name: string, title: string): LocalCourseData {
  return makeMoocKind({ id, name, title } as SharedMoocCourseData)
}

suite("courseSelectionItems", function () {
  const courses = [
    tmcCourse(3, "python-mooc", "Programming 1"),
    moocCourse("course-uuid", "python-mooc", "Programming 1"),
  ]

  test("labels a course by its title and describes it by its backend", function () {
    expect(courseSelectionItems(courses)).toEqual([
      ["Programming 1", makeTmcKind({ courseId: 3 }), "TMC Server"],
      ["Programming 1", makeMoocKind({ instanceId: "course-uuid" }), "courses.mooc.fi"],
    ])
  })

  test("decorate replaces the label of the course it marks and leaves the rest alone", function () {
    const items = courseSelectionItems(courses, {
      decorate: (course, title) => (course.kind === "mooc" ? `${title} (Currently open)` : title),
    })

    expect(items.map(([label]) => label)).toEqual([
      "Programming 1",
      "Programming 1 (Currently open)",
    ])
  })

  test("value chooses what picking a row yields", function () {
    const items = courseSelectionItems(courses, { value: (course) => course })

    expect(items.map(([, value]) => value)).toEqual(courses)
  })
})
