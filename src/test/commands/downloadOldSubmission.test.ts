import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
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
import { createMockActionContext } from "../mocks/actionContext"

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
  let selectedLabels: string[]

  function actionContext(
    options: {
      restore?: MoocOldSubmissionRestore
      submissions?: ExerciseSlideSubmissionListItem[]
      /**
       * Labels to pick at each prompt after the submission picker, in order;
       * `undefined` dismisses that prompt.
       */
      answers?: (string | undefined)[]
    } = {},
  ): ActionContext {
    const base = createMockActionContext()
    const answers = options.answers ?? ["Discard current state", "Yes, discard current state"]

    getMoocOldSubmissions = vi.fn(async () => Ok(options.submissions ?? moocSubmissions))
    downloadMoocOldSubmission = vi.fn(async () => Ok(options.restore ?? "restored"))
    const langs = {
      getMoocOldSubmissions,
      downloadMoocOldSubmission,
    } as unknown as Langs

    const userData = {
      // a mooc exercise yields a string uuid id
      getMoocExerciseByName: () => ({ id: "mooc-ex-uuid" }),
    } as unknown as UserData

    const workspaceManager = {
      get activeExercise() {
        return moocExercise
      },
      getExerciseByPath: () => moocExercise,
    } as unknown as WorkspaceManager

    selectedLabels = []
    notification = vi.fn()
    let call = 0
    const dialog = {
      ...base.dialog,
      selectItem: vi.fn(async (_prompt: string, ...items: [string, unknown][]) => {
        call += 1
        // 1st prompt: the submission picker (pick the first / oldest item).
        if (call === 1) {
          selectedLabels = items.map(([label]) => label)
          return items[0]?.[1]
        }
        const wanted = answers[call - 2]
        return wanted === undefined ? undefined : items.find(([label]) => label === wanted)?.[1]
      }),
      errorNotification: vi.fn(),
      notification,
    } as unknown as ActionContext["dialog"]

    return {
      ...base,
      dialog,
      langs: new Ok(langs),
      userData: new Ok(userData),
      workspaceManager: new Ok(workspaceManager),
    }
  }

  test("lists mooc submissions with score/status labels and downloads the picked one", async function () {
    await downloadOldSubmission(actionContext(), uri)

    // fetched the mooc exercise's submissions by its uuid
    expect(getMoocOldSubmissions).toHaveBeenCalledExactlyOnceWith("mooc-ex-uuid")

    // the picker showed the mooc grading status (not TMC's passed/not-passed only)
    expect(selectedLabels).toHaveLength(2)
    expect(selectedLabels.some((l) => l.includes("Passed"))).toBe(true)
    expect(selectedLabels.some((l) => l.includes("Failed"))).toBe(true)

    // downloaded via the mooc subcommand with the picked (oldest, sorted first)
    // slide-submission id, no save-old-state (we chose discard)
    expect(downloadMoocOldSubmission).toHaveBeenCalledExactlyOnceWith(
      "mooc-ex-uuid",
      uri.fsPath,
      "sub-older",
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

    expect(selectedLabels).toHaveLength(1)
    expect(selectedLabels[0]).toContain("Pending")
  })

  test("submits the current state first when the user asks for it", async function () {
    await downloadOldSubmission(actionContext({ answers: ["Submit to server"] }), uri)

    expect(downloadMoocOldSubmission).toHaveBeenCalledExactlyOnceWith(
      "mooc-ex-uuid",
      uri.fsPath,
      "sub-older",
      true,
    )
  })

  test("downloads nothing when the discard confirmation is dismissed", async function () {
    await downloadOldSubmission(
      actionContext({ answers: ["Discard current state", undefined] }),
      uri,
    )

    expect(downloadMoocOldSubmission).not.toHaveBeenCalled()
  })
})
