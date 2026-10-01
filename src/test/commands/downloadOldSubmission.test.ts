import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { PickableSubmission } from "../../actions"
import type { ActionContext, ReadyActionContext } from "../../actions/types"
import type { Item } from "../../api/dialog"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { downloadOldSubmission } from "../../commands/downloadOldSubmission"
import type { UserData } from "../../config/userdata"
import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
} from "../../shared/langsSchema"
import { ExerciseIdentifier } from "../../shared/shared"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

// jest-mock-vscode ships no `env` namespace.
beforeAll(function () {
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", { value: { language: "en" }, configurable: true })
})

suite("Download old submission command (mooc branch)", function () {
  const uri = vscode.Uri.file("/workspace/mooc/course/ex-1")
  const moocExercise: WorkspaceExercise = {
    backend: "mooc",
    courseSlug: "mooc-course",
    exerciseSlug: "ex-1",
    status: ExerciseStatus.Open,
    uri,
  }

  const moocSubmissions = [
    {
      id: "sub-newer",
      exercise_id: "mooc-ex-uuid",
      created_at: "2026-07-21T12:00:00Z",
      score_given: 1,
      grading_progress: "FullyGraded",
    },
    {
      id: "sub-older",
      exercise_id: "mooc-ex-uuid",
      created_at: "2026-07-21T10:00:00Z",
      score_given: 0,
      grading_progress: "Failed",
    },
  ] as ExerciseSlideSubmissionListItem[]

  let getMoocOldSubmissions: ReturnType<typeof vi.fn>
  let downloadMoocOldSubmission: ReturnType<typeof vi.fn>
  let notification: ReturnType<typeof vi.fn>
  let offered: Item<PickableSubmission>[]
  let pickPrompt: unknown

  function actionContext(
    options: {
      restore?: MoocOldSubmissionRestore
      submissions?: ExerciseSlideSubmissionListItem[]
      /** The button to press in the confirmation after the pick; `undefined` cancels it. */
      answer?: string | undefined
    } = {},
  ): ReadyActionContext {
    const base = createMockActionContext()
    const answer = "answer" in options ? options.answer : "Restore Without Submitting"

    getMoocOldSubmissions = vi.fn(async () => Ok(options.submissions ?? moocSubmissions))
    downloadMoocOldSubmission = vi.fn(async () => Ok(options.restore ?? "restored"))
    const langs = {
      getMoocOldSubmissions,
      downloadMoocOldSubmission,
    } as unknown as Langs

    const userData = {
      // a mooc exercise yields a string uuid id
      getMoocExerciseByName: () => ({ id: "mooc-ex-uuid" }),
      getCourseBySlug: () => Ok({}),
    } as unknown as UserData

    const workspaceManager = {
      get activeExercise() {
        return moocExercise
      },
      getExerciseContaining: () => moocExercise,
    } as unknown as WorkspaceManager

    offered = []
    notification = vi.fn()
    const dialog = Object.assign(createDialogMock()[0], {
      // The submission picker: takes the first item.
      selectItem: vi.fn(async (prompt: unknown, ...items: Item<PickableSubmission>[]) => {
        pickPrompt = prompt
        offered = items
        return items[0]?.value
      }),
      choose: vi.fn(
        async (_message: string, _options: unknown, ...choices: [string, unknown][]) =>
          choices.find(([label]) => label === answer)?.[1],
      ),
      errorNotification: vi.fn(),
      notification,
    }) as unknown as ActionContext["dialog"]

    return {
      ...base,
      dialog,
      startup: { ...base.startup, langs, userData, workspaceManager },
    }
  }

  test("lists submissions newest first, dated in the UI language, with the status beside", async function () {
    await downloadOldSubmission(actionContext({ submissions: moocSubmissions.toReversed() }), uri)

    expect(getMoocOldSubmissions).toHaveBeenCalledExactlyOnceWith("mooc-ex-uuid")
    expect(pickPrompt).toEqual({
      title: "Download Old Submission — ex-1",
      placeHolder: "Pick a submission to restore",
    })
    const format = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
    expect(
      offered.map(({ label, description, detail }) => ({ label, description, detail })),
    ).toEqual([
      {
        label: format.format(new Date("2026-07-21T12:00:00Z")),
        description: "Graded (score 1)",
        detail: "Latest",
      },
      {
        label: format.format(new Date("2026-07-21T10:00:00Z")),
        description: "Failed (score 0)",
        detail: undefined,
      },
    ])
    expect(offered.map(({ iconPath }) => (iconPath as vscode.ThemeIcon).id)).toEqual([
      "circle-large-outline",
      "circle-large-outline",
    ])

    // Restored with the picked submission's id, not saving the current state.
    expect(downloadMoocOldSubmission).toHaveBeenCalledExactlyOnceWith(
      "mooc-ex-uuid",
      uri.fsPath,
      "sub-newer",
      false,
    )
    expect(notification).not.toHaveBeenCalled()
  })

  test("tells the user when the picked submission has no files to download", async function () {
    // Reachable only for a submission the server has no files for. That is
    // ordinary news, not an error notification.
    const context = actionContext({ restore: "nothing-to-download" })
    await downloadOldSubmission(context, uri)

    expect(downloadMoocOldSubmission).toHaveBeenCalledOnce()
    expect(context.dialog.errorNotification).not.toHaveBeenCalled()
    expect(notification).toHaveBeenCalledOnce()
    expect(String(notification.mock.calls[0]?.[0])).toContain("no files to download")
  })

  test("names the exercise by its slug when it has no submissions", async function () {
    await downloadOldSubmission(actionContext({ submissions: [] }), uri)

    expect(notification).toHaveBeenCalledOnce()
    expect(String(notification.mock.calls[0]?.[0])).toContain("ex-1")
    expect(downloadMoocOldSubmission).not.toHaveBeenCalled()
  })

  test("reads a submission the server has not started grading as pending", async function () {
    const pending = [
      { ...moocSubmissions[0], grading_progress: "NotReady", score_given: null },
    ] as ExerciseSlideSubmissionListItem[]
    await downloadOldSubmission(actionContext({ submissions: pending }), uri)

    expect(offered).toHaveLength(1)
    expect(offered[0]?.description).toContain("Pending")
  })

  test("shows progress while fetching and restoring, and says when done", async function () {
    const context = actionContext()

    await downloadOldSubmission(context, uri)

    expect(
      vi.mocked(context.dialog.progressNotification).mock.calls.map(([message]) => message),
    ).toEqual(["Fetching the submissions of ex-1…", "Restoring the old submission of ex-1…"])
    expect(context.dialog.statusMessage).toHaveBeenCalledExactlyOnceWith(
      "Restored the old submission of ex-1.",
    )
  })

  test("submits the current state first when the user asks for it", async function () {
    await downloadOldSubmission(actionContext({ answer: "Submit and Restore" }), uri)

    expect(downloadMoocOldSubmission).toHaveBeenCalledExactlyOnceWith(
      "mooc-ex-uuid",
      uri.fsPath,
      "sub-newer",
      true,
    )
  })

  test("downloads nothing when the confirmation is cancelled", async function () {
    await downloadOldSubmission(actionContext({ answer: undefined }), uri)

    expect(downloadMoocOldSubmission).not.toHaveBeenCalled()
  })

  test("refuses to restore while a submission of the same exercise is in flight", async function () {
    const submission = exerciseOperations
      .claim([ExerciseIdentifier.from("mooc-ex-uuid")], "submitting", 60_000)
      .unwrap()
    try {
      await downloadOldSubmission(actionContext({ answer: "Submit and Restore" }), uri)
    } finally {
      submission.releaseAll()
    }

    expect(downloadMoocOldSubmission).not.toHaveBeenCalled()
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
  })
})
