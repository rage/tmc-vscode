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
  ]

  let getMoocOldSubmissions: ReturnType<typeof vi.fn>
  let downloadMoocOldSubmission: ReturnType<typeof vi.fn>
  let selectedLabels: string[]

  function actionContext(): ActionContext {
    const base = createMockActionContext()

    getMoocOldSubmissions = vi.fn(async () => Ok(moocSubmissions))
    downloadMoocOldSubmission = vi.fn(async () => Ok.EMPTY)
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
    let call = 0
    const dialog = {
      ...base.dialog,
      // 1st prompt: the submission picker (pick the first / oldest item).
      // Later prompts (save-current-state, confirm): "discard".
      selectItem: vi.fn(async (_prompt: string, ...items: [string, unknown][]) => {
        call += 1
        if (call === 1) {
          selectedLabels = items.map(([label]) => label)
          return items[0]?.[1]
        }
        return "discard"
      }),
      errorNotification: vi.fn(),
      notification: vi.fn(),
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
  })
})
