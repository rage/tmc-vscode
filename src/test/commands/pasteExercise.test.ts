import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { BackendKind } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { pasteExercise } from "../../commands/pasteExercise"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  pasteExercise: vi.fn(async (_context: unknown, backend: BackendKind) =>
    Ok(`https://pastebin.example/${backend}`),
  ),
}))

// jest-mock-vscode ships no `env` namespace, so the link-opening assertions
// install one on the mock the `vscode` alias resolves to.
const vscodeMock = vscode as unknown as {
  env: {
    openExternal: (uri: vscode.Uri) => void
    clipboard: { writeText: (text: string) => Promise<void> }
  }
}

type NotificationCall = [string, ...[string, () => unknown][]]

interface Harness {
  context: ReadyActionContext
  notifications: NotificationCall[]
}

const TMC_ID = idOfTmcExercise(1)
const MOOC_ID = idOfMoocExercise("mooc-ex-uuid")

function harness(backend: BackendKind): Harness {
  const exercise: WorkspaceExercise = {
    id: backend === "tmc" ? TMC_ID : MOOC_ID,
    courseId: backend === "tmc" ? idOfTmcCourse(1) : idOfMoocCourse("mooc-course-uuid"),
    backend,
    courseSlug: `${backend}-course`,
    exerciseSlug: "ex-1",
    status: ExerciseStatus.Open,
    uri: vscode.Uri.file(`/workspace/${backend}/course/ex-1`),
  }
  const [dialog] = createDialogMock()
  const notifications: NotificationCall[] = []
  dialog.notification = vi.fn(async (...call: NotificationCall) => {
    notifications.push(call)
  }) as unknown as typeof dialog.notification

  const workspaceManager = {
    get activeExercise() {
      return exercise
    },
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager

  return {
    context: {
      ...createMockActionContext({ startup: { workspaceManager } }),
      dialog,
    },
    notifications,
  }
}

suite("Paste exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.pasteExercise).mockImplementation(async (_context, id) =>
      Ok(`https://pastebin.example/${id.kind}`),
    )
    vscodeMock.env = { openExternal: vi.fn(), clipboard: { writeText: vi.fn(async () => {}) } }
  })

  test("shows progress naming the exercise and the paste service", async function () {
    const { context } = harness("mooc")

    await pasteExercise(context, undefined)

    expect(context.dialog.progressNotification).toHaveBeenCalledWith(
      "Sending ex-1 to courses.mooc.fi paste…",
      expect.any(Function),
    )
  })

  test("pastes a tmc exercise through the tmc backend and offers its link", async function () {
    const { context, notifications } = harness("tmc")

    await pasteExercise(context, undefined)

    expect(actions.pasteExercise).toHaveBeenCalledExactlyOnceWith(context, TMC_ID)
    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      "https://pastebin.example/tmc",
    )
    expect(notifications[0]?.[0]).toBe(
      "Copied the paste link to the clipboard: https://pastebin.example/tmc",
    )
  })

  test("pastes a mooc exercise through the mooc backend", async function () {
    const { context, notifications } = harness("mooc")

    await pasteExercise(context, undefined)

    expect(actions.pasteExercise).toHaveBeenCalledExactlyOnceWith(context, MOOC_ID)
    expect(notifications[0]?.[0]).toBe(
      "Copied the paste link to the clipboard: https://pastebin.example/mooc",
    )
  })

  test("still shows the link when it could not be copied", async function () {
    vi.mocked(vscodeMock.env.clipboard.writeText).mockRejectedValue(new Error("no clipboard"))
    const { context, notifications } = harness("mooc")

    await pasteExercise(context, undefined)

    expect(notifications[0]?.[0]).toBe("Paste link: https://pastebin.example/mooc")
  })

  test("the offered button opens the paste in the browser", async function () {
    const { context, notifications } = harness("mooc")

    await pasteExercise(context, undefined)
    const [label, open] = notifications[0]?.[1] ?? []
    expect(label).toBe("Open in Browser")
    await open?.()

    expect(vscodeMock.env.openExternal).toHaveBeenCalledExactlyOnceWith(
      vscode.Uri.parse("https://pastebin.example/mooc"),
    )
  })

  test("never opens a paste link that is not http(s)", async function () {
    vi.mocked(actions.pasteExercise).mockResolvedValue(Ok("file:///etc/passwd"))
    const { context, notifications } = harness("mooc")

    await pasteExercise(context, undefined)
    const [, open] = notifications[0]?.[1] ?? []
    await open?.()

    expect(vscodeMock.env.openExternal).not.toHaveBeenCalled()
  })

  test("names the paste service on a failure, and offers no link", async function () {
    vi.mocked(actions.pasteExercise).mockResolvedValue(Err(new Error("submission rejected")))
    const { context, notifications } = harness("mooc")

    await pasteExercise(context, undefined)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to send the exercise to courses.mooc.fi paste.",
      expect.objectContaining({ message: "submission rejected" }),
    )
    expect(notifications).toEqual([])
  })
})
