import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
  Submission,
} from "../../../shared/langsSchema"
import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import type { OldSubmission } from "../../actions"
import { listOldSubmissions, submissionHistory } from "../../actions"
import type { ActionContext, ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { downloadOldSubmission } from "../../commands/downloadOldSubmission"
import type { UserData } from "../../config/userdata"
import { restoreSubmission } from "../../panels/restoreSubmission"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { submissionViews } from "../../ui/submissionViews"
import { revertExerciseDocuments, saveExerciseDocuments } from "../../window/exerciseDocuments"
import { moocCourseData, moocCourseExercise } from "../fixtures/courses"
import { idOfMoocCourse, idOfMoocExercise, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../window/exerciseDocuments", () => ({
  revertExerciseDocuments: vi.fn(async () => {}),
  saveExerciseDocuments: vi.fn(async () => Ok.EMPTY),
}))

const uri = vscode.Uri.file("/workspace/mooc/course/ex-1")
const moocExercise: WorkspaceExercise = {
  id: idOfMoocExercise("mooc-ex-uuid"),
  courseId: idOfMoocCourse("mooc-course-uuid"),
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
    kind: "submission",
    is_shared: false,
  },
  {
    id: "sub-older",
    exercise_id: "mooc-ex-uuid",
    created_at: "2026-07-21T10:00:00Z",
    score_given: 0,
    grading_progress: "Failed",
    kind: "submission",
    is_shared: false,
  },
] as ExerciseSlideSubmissionListItem[]

let getOldSubmissions: ReturnType<typeof vi.fn>
let restoreInLangs: ReturnType<typeof vi.fn>

function actionContext(
  options: {
    restore?: MoocOldSubmissionRestore
    listed?: unknown
    availablePoints?: number
    /** The button to press in the confirmation; `undefined` cancels it. */
    answer?: string | undefined
  } = {},
): ReadyActionContext {
  const base = createMockActionContext()
  const answer = "answer" in options ? options.answer : "Restore Without Backup"
  getOldSubmissions = vi.fn(async () =>
    Ok(
      options.listed ?? makeMoocKind({ exerciseId: "mooc-ex-uuid", submissions: moocSubmissions }),
    ),
  )
  restoreInLangs = vi.fn(async () => Ok(options.restore ?? "restored"))
  const langs = { getOldSubmissions, restoreSubmission: restoreInLangs } as unknown as Langs
  const userData = {
    getExercise: () =>
      Ok({
        exercise: makeMoocKind(
          moocCourseExercise({ id: "mooc-ex-uuid", availablePoints: options.availablePoints ?? 1 }),
        ),
        course: makeMoocKind(moocCourseData({ id: "mooc-course-uuid" })),
      }),
    getCourse: () => Ok({}),
  } as unknown as UserData
  const workspaceManager = {
    get activeExercise() {
      return moocExercise
    },
    getExerciseContaining: () => moocExercise,
  } as unknown as WorkspaceManager
  const dialog = Object.assign(createDialogMock()[0], {
    choose: vi.fn(
      async (_message: string, _options: unknown, ...choices: [string, unknown][]) =>
        choices.find(([label]) => label === answer)?.[1],
    ),
    errorNotification: vi.fn(),
    notification: vi.fn(),
  }) as unknown as ActionContext["dialog"]
  return { ...base, dialog, startup: { ...base.startup, langs, userData, workspaceManager } }
}

async function listed(context: ReadyActionContext): Promise<OldSubmission[]> {
  return (await listOldSubmissions(context, moocExercise.id)).unwrap()
}

const NOW = new Date("2026-07-22T00:00:00Z")

function tmcSubmission(overrides: Partial<Submission>): Submission {
  return {
    id: 1,
    created_at: "2026-07-21T12:00:00Z",
    all_tests_passed: false,
    processed: true,
    points: null,
    ...overrides,
  } as Submission
}

suite("Submission history", function () {
  test("the palette's Download Old Submission opens the exercise's History", async function () {
    const reveal = vi.spyOn(submissionViews, "reveal")
    onTestFinished(() => reveal.mockRestore())
    submissionViews.clear()

    await downloadOldSubmission(actionContext(), uri)

    expect(reveal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "ExerciseSubmission", exerciseId: moocExercise.id }),
      { name: "history", shouldPaste: false },
    )
  })

  test("lists graded submissions newest first, dated in the UI language, scored out of the maximum", async function () {
    const context = actionContext({
      listed: makeMoocKind({
        exerciseId: "mooc-ex-uuid",
        submissions: moocSubmissions.toReversed(),
      }),
    })

    const history = submissionHistory(await listed(context), NOW, "en")

    expect(getOldSubmissions).toHaveBeenCalledExactlyOnceWith(idOfMoocExercise("mooc-ex-uuid"))
    const format = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" })
    expect(history).toEqual([
      {
        key: "sub-newer",
        createdAt: "2026-07-21T12:00:00Z",
        dateLabel: format.format(new Date("2026-07-21T12:00:00Z")),
        kind: "submission",
        points: { given: 1, max: 1 },
        status: "Passed",
        isPassed: true,
        isNewestGraded: true,
        isShared: false,
      },
      {
        key: "sub-older",
        createdAt: "2026-07-21T10:00:00Z",
        dateLabel: format.format(new Date("2026-07-21T10:00:00Z")),
        kind: "submission",
        points: { given: 0, max: 1 },
        status: "Grading failed",
        isPassed: false,
        isNewestGraded: false,
        isShared: false,
      },
    ])
  })

  test("marks a fully graded submission below full points as not passed", async function () {
    const partial = [{ ...moocSubmissions[0], score_given: 0.5 }]
    const context = actionContext({
      listed: makeMoocKind({ exerciseId: "mooc-ex-uuid", submissions: partial }),
      availablePoints: 1,
    })

    const [entry] = submissionHistory(await listed(context), NOW, "en")

    expect(entry).toMatchObject({
      status: "Some tests failed",
      points: { given: 0.5, max: 1 },
      isPassed: false,
    })
  })

  test("lists help requests and backups after the submissions, unscored, saying what is shared", async function () {
    const submissions = [
      { ...moocSubmissions[0], kind: "paste", is_shared: true, score_given: null },
      {
        ...moocSubmissions[0],
        created_at: "2026-07-21T11:00:00Z",
        kind: "backup",
        score_given: null,
        grading_progress: null,
      },
      { ...moocSubmissions[1], is_shared: true },
    ]
    const context = actionContext({
      listed: makeMoocKind({ exerciseId: "mooc-ex-uuid", submissions }),
    })

    const history = submissionHistory(await listed(context), NOW, "en")

    expect(
      history.map(({ kind, status, points, isShared }) => ({ kind, status, points, isShared })),
    ).toEqual([
      {
        kind: "submission",
        status: "Grading failed",
        points: { given: 0, max: 1 },
        isShared: true,
      },
      { kind: "paste", status: "Not graded", points: undefined, isShared: true },
      { kind: "backup", status: "Not graded", points: undefined, isShared: false },
    ])
  })

  test("calls a zero score a test failure, and marks the newest submission, not a newer backup", async function () {
    const submissions = [
      {
        ...moocSubmissions[0],
        created_at: "2026-07-21T12:00:01Z",
        kind: "backup",
        score_given: null,
        grading_progress: null,
      },
      { ...moocSubmissions[0], score_given: 0 },
    ]
    const context = actionContext({
      listed: makeMoocKind({ exerciseId: "mooc-ex-uuid", submissions }),
    })

    const history = submissionHistory(await listed(context), NOW, "en")

    expect(history.map(({ status, isNewestGraded }) => [status, isNewestGraded])).toEqual([
      ["Tests failed", true],
      ["Not graded", false],
    ])
    // A second apart, so the labels must tell them apart.
    expect(history[0]?.dateLabel).not.toBe(history[1]?.dateLabel)
  })

  test("reads a submission the server has not started grading as pending", async function () {
    const submissions = [{ ...moocSubmissions[0], grading_progress: "NotReady", score_given: null }]
    const context = actionContext({
      listed: makeMoocKind({ exerciseId: "mooc-ex-uuid", submissions }),
    })

    const [entry] = submissionHistory(await listed(context), NOW, "en")

    expect(entry).toMatchObject({ status: "Pending", isPassed: false })
    expect(entry?.points).toBeUndefined()
  })

  test("scores a tmc submission by the points it was awarded, and leaves an unprocessed one unscored", async function () {
    const context = actionContext({
      availablePoints: 3,
      listed: makeTmcKind({
        exerciseId: 7,
        submissions: [
          tmcSubmission({ id: 3, created_at: "2026-07-21T12:00:00Z", processed: false }),
          tmcSubmission({ id: 2, created_at: "2026-07-21T11:00:00Z", points: "1.1 1.2" }),
          tmcSubmission({
            id: 1,
            created_at: "2026-07-21T10:00:00Z",
            all_tests_passed: true,
            points: "1.1 1.2 1.3",
          }),
        ],
      }),
    })

    const old = (await listOldSubmissions(context, idOfTmcExercise(7))).unwrap()
    const history = submissionHistory(old, NOW, "en")

    expect(
      history.map(({ key, status, points, isPassed }) => ({ key, status, points, isPassed })),
    ).toEqual([
      { key: "3", status: "Pending", points: undefined, isPassed: false },
      { key: "2", status: "Tests failed", points: { given: 2, max: 3 }, isPassed: false },
      { key: "1", status: "Passed", points: { given: 3, max: 3 }, isPassed: true },
    ])
  })
})

suite("Restoring a submission from the History", function () {
  async function firstListed(context: ReadyActionContext): Promise<OldSubmission> {
    const [submission] = await listed(context)
    if (!submission) {
      throw new Error("nothing listed")
    }
    return submission
  }

  test("restores the entry's submission without keeping the current code unless asked", async function () {
    const context = actionContext()

    const restored = await restoreSubmission(context, moocExercise, await firstListed(context))

    expect(restored.val).toBe("restored")
    expect(restoreInLangs).toHaveBeenCalledExactlyOnceWith(
      makeMoocKind({ exerciseId: "mooc-ex-uuid", submissionId: "sub-newer" }),
      uri.fsPath,
      false,
    )
    expect(saveExerciseDocuments).not.toHaveBeenCalled()
    expect(revertExerciseDocuments).toHaveBeenCalledExactlyOnceWith(moocExercise)
  })

  test("backs up the current code first when the student asks for it", async function () {
    const context = actionContext({ answer: "Back Up and Restore" })

    await restoreSubmission(context, moocExercise, await firstListed(context))

    expect(saveExerciseDocuments).toHaveBeenCalledExactlyOnceWith(moocExercise)
    expect(restoreInLangs).toHaveBeenCalledExactlyOnceWith(
      makeMoocKind({ exerciseId: "mooc-ex-uuid", submissionId: "sub-newer" }),
      uri.fsPath,
      true,
    )
  })

  test("says when the submission has no files, as an outcome rather than a failure", async function () {
    const context = actionContext({ restore: "nothing-to-download" })

    const restored = await restoreSubmission(context, moocExercise, await firstListed(context))

    expect(restored.val).toBe("nothingToDownload")
    expect(revertExerciseDocuments).not.toHaveBeenCalled()
  })

  test("leaves the editors alone when the restore fails", async function () {
    const context = actionContext()
    restoreInLangs.mockResolvedValue(Err(new Error("disk full")))

    const restored = await restoreSubmission(context, moocExercise, await firstListed(context))

    expect(restored.err).toBe(true)
    expect(revertExerciseDocuments).not.toHaveBeenCalled()
  })

  test("restores nothing when the confirmation is cancelled", async function () {
    const context = actionContext({ answer: undefined })

    const restored = await restoreSubmission(context, moocExercise, await firstListed(context))

    expect(restored.val).toBe("cancelled")
    expect(restoreInLangs).not.toHaveBeenCalled()
  })

  test("refuses to restore while a submission of the same exercise is in flight", async function () {
    const context = actionContext({ answer: "Back Up and Restore" })
    const submission = await firstListed(context)
    const inFlight = exerciseOperations
      .claim([idOfMoocExercise("mooc-ex-uuid")], "submitting")
      .unwrap()
    try {
      const restored = await restoreSubmission(context, moocExercise, submission)
      expect(restored.val).toEqual(
        expect.objectContaining({
          message: "A submission for this exercise is already in progress.",
        }),
      )
    } finally {
      inFlight.releaseAll()
    }
    expect(restoreInLangs).not.toHaveBeenCalled()
  })
})
