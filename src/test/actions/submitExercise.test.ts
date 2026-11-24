import { Err, Ok } from "ts-results"
import { onTestFinished, vi } from "vitest"
import type * as vscode from "vscode"

import type { ExerciseStanding } from "../../../shared/langsSchema"
import type { CourseIdentifier, ExerciseSubmissionPanel, SubmissionView } from "../../../shared/lib"
import {
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  makeMoocKind,
  makeTmcKind,
} from "../../../shared/lib"
import { exerciseResultsPanel } from "../../actions/exerciseResults"
import { pendingGradings } from "../../actions/pendingGradings"
import {
  cancelSubmissionUpload,
  checkCanSubmit,
  keepWaitingForGrading,
  onDidFinishSubmission,
  sendSubmissionFeedback,
  submitExercise,
} from "../../actions/submitExercise"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import { langsError } from "../../api/langsErrors"
import { failure } from "../../api/withOperation"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { runForExercise } from "../../commands/runForExercise"
import {
  AiUseRefusedError,
  BottleneckError,
  CourseAccessLostError,
  DeadlinePassedError,
  ExerciseNotFoundError,
  InsufficientScopeError,
  NotEnrolledError,
  NotFoundError,
  WorkspaceUntrustedError,
} from "../../errors"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import type { BackgroundJob } from "../../ui/backgroundJobs"
import { backgroundJobs } from "../../ui/backgroundJobs"
import type { SubmissionViewUpdate } from "../../ui/submissionViews"
import { submissionViews } from "../../ui/submissionViews"
import { saveExerciseDocuments } from "../../window/exerciseDocuments"
import {
  moocCourseData,
  moocCourseExercise,
  tmcCourseData,
  tmcCourseExercise,
} from "../fixtures/courses"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createMockContext } from "../mocks/vscode"
import { restrictedTrustGate } from "../support/trustGate"

vi.mock("../../window/exerciseDocuments", () => ({
  saveExerciseDocuments: vi.fn(async () => Ok.EMPTY),
}))
vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn(async () => Ok({ isUpdated: false, warnings: [] })),
}))

const openedPanels: ExerciseSubmissionPanel[] = []
const viewUpdates: SubmissionViewUpdate[] = []
const finishedCourses: CourseIdentifier[] = []
submissionViews.onDidOpen((panel) => openedPanels.push(panel))
submissionViews.onDidUpdate((update) => viewUpdates.push(update))
onDidFinishSubmission((courseId) => finishedCourses.push(courseId))

beforeEach(() => {
  openedPanels.length = 0
  viewUpdates.length = 0
  finishedCourses.length = 0
})

const COURSE_SLUG = "mooc-python-course"
const EXERCISE_SLUG = "loops"
const MOOC_EXERCISE_ID = "mooc-ex-1"

const TMC_COURSE_SLUG = "test-python-course"
const TMC_EXERCISE_ID = 4321

const moocCourse: MoocLocalCourseData = moocCourseData({
  id: "instance-uuid-1",
  name: COURSE_SLUG,
  title: "Mooc Python",
  availablePoints: 3,
  exercises: [
    moocCourseExercise({ id: MOOC_EXERCISE_ID, name: EXERCISE_SLUG, availablePoints: 3 }),
  ],
})

const tmcCourse: TmcLocalCourseData = tmcCourseData({
  id: 7,
  name: TMC_COURSE_SLUG,
  title: "Test Python",
  description: "A tmc course",
  organization: "test",
  exercises: [tmcCourseExercise({ id: TMC_EXERCISE_ID, name: EXERCISE_SLUG, availablePoints: 2 })],
  availablePoints: 2,
})

const moocExercise: WorkspaceExercise = {
  id: idOfMoocExercise(MOOC_EXERCISE_ID),
  courseId: idOfMoocCourse(moocCourse.id),
  backend: "mooc",
  courseSlug: COURSE_SLUG,
  exerciseSlug: EXERCISE_SLUG,
  status: ExerciseStatus.Open,
  uri: { fsPath: "/path/to/exercise" } as unknown as vscode.Uri,
}

const tmcExercise: WorkspaceExercise = {
  ...moocExercise,
  id: idOfTmcExercise(TMC_EXERCISE_ID),
  courseId: idOfTmcCourse(tmcCourse.id),
  backend: "tmc",
  courseSlug: TMC_COURSE_SLUG,
}

// `langsMethods` holds only the backend's own submit call, so a submission routed
// through the other backend's method fails instead of quietly passing.
function contextFor(
  course: LocalCourseData,
  langsMethods: Record<string, unknown>,
): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
  setStanding: ReturnType<typeof vi.fn>
} {
  let isPassed = false
  const setPassed = vi.fn(async () => {
    isPassed = true
    return Ok.EMPTY
  })
  const setStanding = vi.fn(async (_id: unknown, standing: { passed: boolean }) => {
    isPassed = standing.passed
    return Ok.EMPTY
  })
  const actionContext = createMockActionContext({
    startup: {
      langs: langsMethods as unknown as ReadyStartup["langs"],
      userData: {
        // Any id but another exercise of the course is the submitted one.
        getExercise: (id: ExerciseIdentifier) => {
          const exercises = LocalCourseData.getExercises(course)
          const exercise =
            exercises.find(
              (x) =>
                ExerciseIdentifier.key(LocalCourseExercise.getId(x)) === ExerciseIdentifier.key(id),
            ) ?? exercises[0]
          return Ok({ course, exercise })
        },
        getPassed: () => isPassed,
        getCourse: () => Ok(course),
        setExerciseAsPassed: setPassed,
        setMoocExerciseStanding: setStanding,
        replaceCourse: vi.fn(async () => Ok.EMPTY),
      } as unknown as ReadyStartup["userData"],
      exerciseDecorationProvider: {
        updateDecorationsForExercises: vi.fn(),
      } as unknown as ReadyStartup["exerciseDecorationProvider"],
    },
  })
  return { actionContext, setPassed, setStanding }
}

const TASK_SUBMISSION_ID = "task-submission-1"
const EXERCISE_PAGE_URL = "https://courses.mooc.fi/org/uh-cs/courses/python/chapter-1/page-1"

function moocContextWith(gradingResult: unknown): {
  actionContext: ReadyActionContext
  setStanding: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
  wait: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(
    Ok({
      task_submission_id: TASK_SUBMISSION_ID,
      slide_submission_id: "slide-submission-1",
      exercise_page_url: EXERCISE_PAGE_URL,
    }),
  )
  const wait = vi.fn().mockResolvedValue(Ok(gradingResult))
  const { actionContext, setStanding } = contextFor(makeMoocKind(moocCourse), {
    submitMoocExercise: submit,
    waitForMoocGrading: wait,
  })
  return { actionContext, setStanding, submit, wait }
}

// Like `moocContextWith`, but the submit itself resolves to an `Err`.
function moocContextWithErr(error: Error): {
  actionContext: ReadyActionContext
  setStanding: ReturnType<typeof vi.fn>
} {
  return contextFor(makeMoocKind(moocCourse), {
    submitMoocExercise: vi.fn().mockResolvedValue(Err(error)),
  })
}

/** Every view the action showed, oldest first. */
function shownViews(): SubmissionView[] {
  return viewUpdates.map(({ view }) => view)
}

function lastView(): SubmissionView | undefined {
  return shownViews().at(-1)
}

function shownPanelId(): number {
  const route = openedPanels.at(-1)
  if (route === undefined) {
    throw new Error("no submission panel was rendered")
  }
  return route.id
}

/** The backend's progress on the exercise, as a grading reports it. */
function progress(standing: ExerciseStanding, scoreGiven: number): Record<string, unknown> {
  return {
    exercise_id: MOOC_EXERCISE_ID,
    score_given: scoreGiven,
    score_maximum: 3,
    completed: true,
    attempted: true,
    standing,
  }
}

function grading(overrides: Record<string, unknown>): unknown {
  return {
    status: "grading",
    grading: {
      grading_progress: "FullyGraded",
      score_given: null,
      grading_started_at: null,
      grading_completed_at: null,
      feedback_text: null,
      ...overrides,
    },
  }
}

function tmcContextWith(
  submitResult: unknown,
  course: TmcLocalCourseData = tmcCourse,
): {
  actionContext: ReadyActionContext
  setPassed: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
} {
  const submit = vi.fn().mockResolvedValue(Ok(submitResult))
  const { actionContext, setPassed } = contextFor(makeTmcKind(course), {
    submitTmcExerciseAndWaitForResults: submit,
  })
  return { actionContext, setPassed, submit }
}

suite("submitExercise action, tmc", () => {
  const passingSubmission = {
    status: "ok",
    all_tests_passed: true,
    points: ["01-01"],
    test_cases: [],
    feedback_questions: [{ id: 3, question: "How was it?", kind: "Text" }],
  }

  test("submits through the tmc call and posts the full result", async () => {
    const { actionContext, setPassed, submit } = tmcContextWith(passingSubmission)

    const result = await submitExercise(actionContext, tmcExercise)
    expect(result.ok).toBe(true)

    expect(submit).toHaveBeenCalledWith(
      TMC_EXERCISE_ID,
      "/path/to/exercise",
      expect.any(Function),
      expect.any(Function),
    )
    expect(lastView()).toMatchObject({
      phase: "finished",
      headline: "Passed",
      points: { given: 1, max: 2 },
    })
    expect(setPassed).toHaveBeenCalledWith(idOfTmcExercise(TMC_EXERCISE_ID))
    expect(finishedCourses).toEqual([idOfTmcCourse(tmcCourse.id)])
    // Only the outcome brings back a side panel the student closed while it was graded.
    expect(viewUpdates.map(({ shouldReopen }) => shouldReopen).at(-1)).toBe(true)
    expect(viewUpdates.slice(0, -1).every(({ shouldReopen }) => !shouldReopen)).toBe(true)
  })

  test("the submission's page on the server reaches the panel", async () => {
    // Only the tmc backend has one, and it arrives through its own callback
    // before the grading does, so the panel can offer it while it waits.
    const { actionContext, submit } = tmcContextWith(passingSubmission)

    await submitExercise(actionContext, tmcExercise)

    const onSubmissionUrl = submit.mock.calls[0]?.[3] as (url: string) => void
    onSubmissionUrl("https://tmc.mooc.fi/submissions/1")
    expect(lastView()).toMatchObject({
      phase: "grading",
      submissionUrl: "https://tmc.mooc.fi/submissions/1",
    })
  })

  test("progress arrives as the uploading view until the server has the submission", async () => {
    const { actionContext, submit } = tmcContextWith(passingSubmission)

    await submitExercise(actionContext, tmcExercise)

    const onProgress = submit.mock.calls[0]?.[2] as (fraction: number, message?: string) => void
    onProgress(0.25, "Compressing")
    expect(lastView()).toMatchObject({
      phase: "uploading",
      progressFraction: 0.25,
      progressSteps: ["Compressing"],
    })
  })

  test("a failing submission posts the result but does not mark passed", async () => {
    const { actionContext, setPassed } = tmcContextWith({
      status: "ok",
      all_tests_passed: false,
      points: [],
      test_cases: [],
    })

    await submitExercise(actionContext, tmcExercise)

    expect(setPassed).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "finished", canPaste: true, feedback: undefined })
  })

  test("a pass offers the next exercise left to do", async () => {
    const { actionContext } = tmcContextWith(passingSubmission, {
      ...tmcCourse,
      exercises: [
        ...tmcCourse.exercises,
        tmcCourseExercise({ id: TMC_EXERCISE_ID + 1, name: "next_exercise" }),
      ],
    })

    await submitExercise(actionContext, tmcExercise)

    expect(lastView()).toMatchObject({
      isExercisePassed: true,
      nextExercise: { name: "next_exercise" },
    })
  })

  test("a failure offers no next exercise", async () => {
    const { actionContext } = tmcContextWith(
      { status: "ok", all_tests_passed: false, points: [], test_cases: [] },
      {
        ...tmcCourse,
        exercises: [...tmcCourse.exercises, tmcCourseExercise({ id: 1, name: "part02-01_next" })],
      },
    )

    await submitExercise(actionContext, tmcExercise)

    expect(lastView()?.isExercisePassed).toBe(false)
    expect(lastView()?.nextExercise).toBeUndefined()
  })

  test("an exercise whose id is from the other backend is refused", async () => {
    // Submitting it anyway would send the work to the wrong server.
    const submit = vi.fn()
    const { actionContext } = contextFor(makeTmcKind(tmcCourse), {
      submitTmcExerciseAndWaitForResults: submit,
    })

    const result = await submitExercise(actionContext, {
      ...tmcExercise,
      id: idOfMoocExercise(MOOC_EXERCISE_ID),
    })

    expect(result.err).toBe(true)
    expect((result.val as Error).message).toContain("is not a tmc.mooc.fi exercise")
    expect(submit).not.toHaveBeenCalled()
  })
})

suite("submitExercise action, mooc", () => {
  test("saves the exercise's editors before submitting", async () => {
    const { actionContext, submit } = moocContextWith(grading({ score_given: 3 }))
    vi.mocked(saveExerciseDocuments).mockImplementationOnce(async () => {
      expect(submit).not.toHaveBeenCalled()
      return Ok.EMPTY
    })

    await submitExercise(actionContext, moocExercise)

    expect(saveExerciseDocuments).toHaveBeenCalledExactlyOnceWith(moocExercise)
    expect(submit).toHaveBeenCalledOnce()
  })

  test("submits nothing when the exercise's editors cannot be saved", async () => {
    const { actionContext, submit } = moocContextWith(grading({ score_given: 3 }))
    vi.mocked(saveExerciseDocuments).mockResolvedValueOnce(Err(new Error("Could not save a.py.")))

    const result = await submitExercise(actionContext, moocExercise)

    expect(result.err).toBe(true)
    expect(submit).not.toHaveBeenCalled()
  })

  test("submits without blocking, then waits for that submission's grading", async () => {
    const graded = grading({
      score_given: 3,
      feedback_text: "All tests passed",
      exercise_progress: progress("Passed", 3),
    })
    const { actionContext, setStanding, submit, wait } = moocContextWith(graded)

    const result = await submitExercise(actionContext, moocExercise)
    expect(result.ok).toBe(true)

    expect(submit).toHaveBeenCalledWith(MOOC_EXERCISE_ID, "/path/to/exercise", expect.any(Function))
    expect(wait).toHaveBeenCalledWith(TASK_SUBMISSION_ID, expect.any(Function))
    expect(shownViews().map((view) => view.phase)).toEqual(["uploading", "grading", "finished"])
    expect(lastView()).toMatchObject({
      headline: "Passed",
      points: { given: 3, max: 3 },
      feedbackText: "All tests passed",
      canKeepWaiting: false,
    })
    expect(setStanding).toHaveBeenCalledWith(
      idOfMoocExercise(MOOC_EXERCISE_ID),
      { passed: true, attempted: true, outOfTries: false },
      3,
    )
    expect(finishedCourses).toEqual([idOfMoocCourse(moocCourse.id)])
  })

  test("runs as a long job of the results screen, renamed once the backend has the submission", async () => {
    const { actionContext } = moocContextWith(grading({ score_given: 3 }))
    const labels: string[] = []
    const seen: BackgroundJob[] = []
    const subscription = backgroundJobs.onDidChange(() => {
      seen.push(...backgroundJobs.running)
      labels.push(...backgroundJobs.running.map((job) => job.label))
    })
    onTestFinished(() => subscription.dispose())

    await submitExercise(actionContext, moocExercise)

    expect([...new Set(labels)]).toEqual([
      `Submitting ${moocExercise.exerciseSlug}`,
      `Waiting for grading of ${moocExercise.exerciseSlug}`,
    ])
    expect(seen[0]).toMatchObject({
      screen: { kind: "results", exerciseId: moocExercise.id, exerciseUri: moocExercise.uri },
      isLong: true,
    })
    expect(backgroundJobs.running).toEqual([])
  })

  test("offers the exercise's page from the moment the backend has the submission", async () => {
    const { actionContext } = moocContextWith(grading({ score_given: 3 }))

    await submitExercise(actionContext, moocExercise)

    expect(shownViews().map((view) => view.submissionUrl)).toEqual([
      undefined,
      EXERCISE_PAGE_URL,
      EXERCISE_PAGE_URL,
    ])
  })

  test("links the stored material page when the backend names none", async () => {
    const storedPage = "https://courses.mooc.fi/org/uh-cs/courses/python/stored-page"
    const { actionContext } = contextFor(
      makeMoocKind({
        ...moocCourse,
        exercises: [
          moocCourseExercise({
            id: MOOC_EXERCISE_ID,
            name: EXERCISE_SLUG,
            availablePoints: 3,
            pageUrl: storedPage,
          }),
        ],
      }),
      {
        submitMoocExercise: vi.fn().mockResolvedValue(
          Ok({
            task_submission_id: TASK_SUBMISSION_ID,
            slide_submission_id: "slide-submission-1",
            exercise_page_url: null,
          }),
        ),
        waitForMoocGrading: vi
          .fn()
          .mockResolvedValue(
            Ok(grading({ score_given: 3, exercise_progress: progress("Passed", 3) })),
          ),
      },
    )

    await submitExercise(actionContext, moocExercise)

    expect(lastView()).toMatchObject({ submissionUrl: storedPage })
  })

  test("a completed grading below full points is recorded as not passed", async () => {
    const { actionContext, setStanding } = moocContextWith(
      grading({ score_given: 2, exercise_progress: progress("Attempted", 2) }),
    )

    await submitExercise(actionContext, moocExercise)
    expect(setStanding).toHaveBeenCalledWith(
      idOfMoocExercise(MOOC_EXERCISE_ID),
      { passed: false, attempted: true, outOfTries: false },
      2,
    )
    expect(lastView()).toMatchObject({
      headline: "Not passed",
      canPaste: true,
    })
  })

  test("the last try below full points is recorded and shown as final", async () => {
    const { actionContext, setStanding } = moocContextWith(
      grading({ score_given: 2, exercise_progress: progress("OutOfTries", 2) }),
    )

    await submitExercise(actionContext, moocExercise)
    expect(setStanding).toHaveBeenCalledWith(
      idOfMoocExercise(MOOC_EXERCISE_ID),
      { passed: false, attempted: true, outOfTries: true },
      2,
    )
    expect(lastView()).toMatchObject({
      headline: "Not passed",
      explanation: "That was your last try, so this score is final.",
    })
  })

  test("leaves the standing to the course refresh when the grading reports none", async () => {
    const { actionContext, setStanding } = moocContextWith(grading({ score_given: 3 }))

    await submitExercise(actionContext, moocExercise)
    expect(setStanding).not.toHaveBeenCalled()
  })

  test("submits an exercise stored as out of tries, and shows courses.mooc.fi's refusal", async () => {
    const outOfTries = {
      ...moocCourse,
      exercises: [{ ...moocCourse.exercises[0]!, awardedPoints: 2, outOfTries: true }],
    }
    const submit = vi
      .fn()
      .mockResolvedValue(Err(langsError({ kind: "out-of-tries" }, "403", "", "mooc")))
    const { actionContext } = contextFor(makeMoocKind(outOfTries), { submitMoocExercise: submit })

    const result = await submitExercise(actionContext, moocExercise)

    expect(result.ok).toBe(true)
    expect(submit).toHaveBeenCalledOnce()
    expect(lastView()?.error?.message).toBe(
      "You have no tries left on this exercise, so it can no longer be submitted.",
    )
    expect(finishedCourses).toEqual([idOfMoocCourse(moocCourse.id)])
  })

  test("refuses up front a tmc exercise past its deadline", async () => {
    const late = {
      ...tmcCourse,
      exercises: [{ ...tmcCourse.exercises[0]!, deadline: "2000-01-01T00:00:00Z" }],
    }
    const submit = vi.fn()
    const { actionContext } = contextFor(makeTmcKind(late), {
      submitTmcExerciseAndWaitForResults: submit,
    })

    const result = await submitExercise(actionContext, tmcExercise)

    expect(result.val).toBeInstanceOf(DeadlinePassedError)
    expect((result.val as Error).message).toBe(
      `The deadline of ${EXERCISE_SLUG} has passed, so it can no longer be submitted.`,
    )
    expect(submit).not.toHaveBeenCalled()
  })

  test("refuses a course its backend refused once a refresh finds it still refused", async () => {
    const lost = { ...moocCourse, accessLoss: { reason: "forbidden" as const, checkedAt: 0 } }
    const submit = vi.fn()
    const { actionContext } = contextFor(makeMoocKind(lost), { submitMoocExercise: submit })

    const result = await submitExercise(actionContext, moocExercise)

    expect(updateCourse).toHaveBeenCalledOnce()
    expect(result.val).toBeInstanceOf(CourseAccessLostError)
    expect((result.val as Error).message).toBe(
      `You no longer have access to this course, so ${EXERCISE_SLUG} cannot be submitted.`,
    )
    expect(submit).not.toHaveBeenCalled()
  })

  test("submits once the refresh finds the course served again", async () => {
    const lost: MoocLocalCourseData = {
      ...moocCourse,
      accessLoss: { reason: "notFound", checkedAt: 0 },
    }
    const { actionContext } = contextFor(makeMoocKind(lost), {
      submitMoocExercise: vi.fn(async () =>
        Ok({
          task_submission_id: TASK_SUBMISSION_ID,
          slide_submission_id: "slide-submission-1",
          exercise_page_url: EXERCISE_PAGE_URL,
        }),
      ),
      waitForMoocGrading: vi.fn(async () => Ok(grading({}))),
    })
    vi.mocked(updateCourse).mockImplementationOnce(async () => {
      delete lost.accessLoss
      return Ok({ isUpdated: true, warnings: [] })
    })

    const result = await submitExercise(actionContext, moocExercise)

    expect(result.ok).toBe(true)
    expect(actionContext.startup.langs.submitMoocExercise).toHaveBeenCalledOnce()
  })

  test("a refusal the stored data did not foresee shows in the panel and refreshes the course", async () => {
    const { actionContext } = moocContextWithErr(new DeadlinePassedError("deadline passed"))

    await submitExercise(actionContext, moocExercise)

    expect(lastView()?.error?.message).toBe("Deadline passed.")
    expect(finishedCourses).toEqual([idOfMoocCourse(moocCourse.id)])
  })

  test("submits nothing in Restricted Mode", async () => {
    const submit = vi.fn()
    const { actionContext } = contextFor(makeMoocKind(moocCourse), { submitMoocExercise: submit })
    actionContext.startup.trustGate = restrictedTrustGate().trustGate

    const result = await submitExercise(actionContext, moocExercise)

    expect(result.val).toBeInstanceOf(WorkspaceUntrustedError)
    expect(submit).not.toHaveBeenCalled()
  })

  test("checking whether it can submit refuses as the submit would, and submits nothing", async () => {
    const pastDeadline = {
      ...tmcCourse,
      exercises: [{ ...tmcCourse.exercises[0]!, deadline: "2000-01-01T00:00:00Z" }],
    }
    const submit = vi.fn()
    const late = contextFor(makeTmcKind(pastDeadline), {
      submitTmcExerciseAndWaitForResults: submit,
    })
    expect((await checkCanSubmit(late.actionContext, tmcExercise)).val).toBeInstanceOf(
      DeadlinePassedError,
    )

    const aiOn = contextFor(makeMoocKind(moocCourse), { submitMoocExercise: submit })
    const refused = new AiUseRefusedError("AI assistance is on.")
    aiOn.actionContext.startup.aiUseGate = {
      refusal: async () => refused,
    } as unknown as ReadyStartup["aiUseGate"]
    expect((await checkCanSubmit(aiOn.actionContext, moocExercise)).val).toBe(refused)

    const allowed = contextFor(makeMoocKind(moocCourse), { submitMoocExercise: submit })
    expect((await checkCanSubmit(allowed.actionContext, moocExercise)).ok).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    expect(openedPanels).toEqual([])
  })

  test("refreshes the course before refusing for AI, as the teacher may have allowed it since", async () => {
    const submit = vi.fn()
    const stale = contextFor(makeMoocKind(moocCourse), { submitMoocExercise: submit })
    const refusal = vi
      .fn()
      .mockResolvedValueOnce(new AiUseRefusedError("AI assistance is on."))
      .mockResolvedValueOnce(undefined)
    stale.actionContext.startup.aiUseGate = { refusal } as unknown as ReadyStartup["aiUseGate"]
    vi.mocked(updateCourse).mockResolvedValueOnce(Ok({ isUpdated: true, warnings: [] }))

    expect((await checkCanSubmit(stale.actionContext, moocExercise)).ok).toBe(true)
    expect(updateCourse).toHaveBeenCalledOnce()
    expect(refusal).toHaveBeenCalledTimes(2)
  })

  test("grading progress keeps changed messages only, on an indeterminate bar", async () => {
    const { actionContext, wait } = moocContextWith(grading({ score_given: 3 }))

    await submitExercise(actionContext, moocExercise)

    const onProgress = wait.mock.calls[0]?.[1] as (fraction: number, message?: string) => void
    onProgress(1, "Grading in progress")
    onProgress(1, "Grading in progress")
    expect(lastView()).toMatchObject({ phase: "grading", progressSteps: ["Grading in progress"] })
    expect(lastView()?.progressFraction).toBeUndefined()
  })

  test("a failed grading does not mark the exercise passed", async () => {
    const { actionContext, setStanding } = moocContextWith(
      grading({ grading_progress: "Failed", score_given: 0 }),
    )

    await submitExercise(actionContext, moocExercise)
    expect(setStanding).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "failed", headline: "Grading failed" })
  })

  test("a pending-manual grading is shown but does not mark passed", async () => {
    const { actionContext, setStanding } = moocContextWith(
      grading({ grading_progress: "PendingManual", score_given: 0.5 }),
    )

    const result = await submitExercise(actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setStanding).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "manualReview", canKeepWaiting: false })
  })

  test("a grading still pending when the CLI stops waiting can be waited for again", async () => {
    const { actionContext, setStanding, wait } = moocContextWith(
      grading({ grading_progress: "Pending" }),
    )

    const result = await submitExercise(actionContext, moocExercise)
    expect(result.ok).toBe(true)
    expect(setStanding).not.toHaveBeenCalled()
    expect(lastView()).toMatchObject({ phase: "timedOut", canKeepWaiting: true })

    wait.mockResolvedValueOnce(
      Ok(grading({ score_given: 3, exercise_progress: progress("Passed", 3) })),
    )
    const panelId = shownPanelId()
    const waited = await keepWaitingForGrading(actionContext, panelId)

    expect(waited.ok).toBe(true)
    expect(finishedCourses).toEqual([idOfMoocCourse(moocCourse.id), idOfMoocCourse(moocCourse.id)])
    expect(wait).toHaveBeenLastCalledWith(TASK_SUBMISSION_ID, expect.any(Function))
    expect(lastView()).toMatchObject({
      phase: "finished",
      points: { given: 3, max: 3 },
      submissionUrl: EXERCISE_PAGE_URL,
    })
    expect(setStanding).toHaveBeenCalledWith(
      idOfMoocExercise(MOOC_EXERCISE_ID),
      { passed: true, attempted: true, outOfTries: false },
      3,
    )

    const again = await keepWaitingForGrading(actionContext, panelId)
    expect(again.err).toBe(true)
  })

  test("a newer submission's panel leaves nothing to wait for in the one it replaced", async () => {
    const { actionContext } = moocContextWith(grading({ grading_progress: "Pending" }))
    await submitExercise(actionContext, moocExercise)
    const replacedPanelId = shownPanelId()

    await submitExercise(actionContext, moocExercise)

    const waited = await keepWaitingForGrading(actionContext, replacedPanelId)
    expect(waited.err).toBe(true)
    const current = await keepWaitingForGrading(actionContext, shownPanelId())
    expect(current.ok).toBe(true)
  })

  test("a submission of another exercise leaves the earlier one's grading to wait for", async () => {
    const { actionContext } = moocContextWith(grading({ grading_progress: "Pending" }))
    await submitExercise(actionContext, moocExercise)
    const earlierPanelId = shownPanelId()

    const tmcSubmission = { status: "ok", all_tests_passed: true, points: [], test_cases: [] }
    await submitExercise(tmcContextWith(tmcSubmission).actionContext, tmcExercise)

    const waited = await keepWaitingForGrading(actionContext, earlierPanelId)
    expect(waited.ok).toBe(true)
  })

  test("a grading the server refuses to show offers no keep waiting", async () => {
    const { actionContext, wait } = moocContextWith(undefined)
    wait.mockResolvedValue(Err(new NotFoundError("gone")))

    await submitExercise(actionContext, moocExercise)

    expect(lastView()).toMatchObject({ phase: "failed", canKeepWaiting: false })
  })

  test("a failed status check after the submit still offers to keep waiting", async () => {
    const { actionContext, wait } = moocContextWith(undefined)
    wait.mockResolvedValue(Err(new Error("Connection reset by peer")))

    const result = await submitExercise(actionContext, moocExercise)

    expect(result.ok).toBe(true)
    expect(lastView()).toMatchObject({
      phase: "failed",
      canKeepWaiting: true,
      error: { message: "Connection reset by peer." },
    })
  })

  test("keeping waiting for a panel with no unfinished grading errs", async () => {
    const { actionContext, wait } = moocContextWith(grading({}))

    const waited = await keepWaitingForGrading(actionContext, -1)

    expect(waited.err).toBe(true)
    expect(wait).not.toHaveBeenCalled()
  })

  test("a second submit of the same exercise is rejected while one is in flight", async () => {
    // The guard lives in the action because `TmcPanel` calls the paste actions, which share
    // this key, directly. `withOperation` shows the rejection; showing it here too would double it.
    let finishFirst!: () => void
    const submit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishFirst = () => resolve(Err(new Error("offline")))
      }),
    )
    const { actionContext } = contextFor(makeMoocKind(moocCourse), {
      submitMoocExercise: submit,
    })
    const notification = vi.mocked(actionContext.dialog.notification)

    const first = submitExercise(actionContext, moocExercise)
    const second = await submitExercise(actionContext, moocExercise)

    expect(second.err).toBe(true)
    expect(second.val).toBeInstanceOf(BottleneckError)
    expect(notification).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledTimes(1)

    finishFirst()
    await first

    // and the key is free again once the first submit finishes
    await submitExercise(actionContext, moocExercise)
    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("the failure survives the webview boundary with its message intact", async () => {
    // The panel reads `error.message`, and the webview bridge serializes the
    // message as JSON -- which drops a live Error's non-enumerable `message`.
    const { actionContext } = moocContextWithErr(new Error("Connection reset by peer"))

    await submitExercise(actionContext, moocExercise)

    const delivered = JSON.parse(JSON.stringify(lastView())) as SubmissionView
    expect(delivered.error?.message).toBe("Connection reset by peer.")
  })

  test("a submission refused as not enrolled marks the course for the course home", async () => {
    const { actionContext } = moocContextWithErr(new NotEnrolledError("not enrolled"))

    await submitExercise(actionContext, moocExercise)

    expect(actionContext.startup.userData.replaceCourse).toHaveBeenCalledExactlyOnceWith(
      makeMoocKind({ ...moocCourse, notEnrolled: true }),
    )
  })
})

function submitBody(actionContext: ReadyActionContext) {
  return (exercise: WorkspaceExercise) =>
    submitExercise(actionContext, exercise).then((result) =>
      result.err ? failure("Exercise submission failed.", result.val) : result,
    )
}

// Drives the action through the real `runForExercise`/`withOperation` boundary (bypassing only
// `commands/submitExercise`): the busy notice is shown exactly once, and a failure the panel
// shows, remedies included, is not also notified.
suite("submitExercise action, through the real runForExercise boundary", () => {
  function contextWithWorkspace(
    course: LocalCourseData,
    langsMethods: Record<string, unknown>,
    exercise: WorkspaceExercise,
  ): ReadyActionContext {
    const { actionContext } = contextFor(course, langsMethods)
    const workspaceManager = {
      get activeExercise() {
        return exercise
      },
      getExerciseContaining: () => exercise,
    } as unknown as ReadyStartup["workspaceManager"]
    return { ...actionContext, startup: { ...actionContext.startup, workspaceManager } }
  }

  test("a busy rejection notifies exactly once and reports no error", async () => {
    let finishFirst!: () => void
    const submit = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finishFirst = () => resolve(Err(new Error("offline")))
      }),
    )
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: submit },
      moocExercise,
    )
    const notification = vi.mocked(actionContext.dialog.notification)
    const reportError = vi.mocked(actionContext.dialog.reportError)

    const first = runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )
    const second = await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(second.err).toBe(true)
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "A submission for this exercise is already in progress.",
    )
    expect(reportError).not.toHaveBeenCalled()

    finishFirst()
    await first
  })

  test("a plain submission failure shows in the panel only", async () => {
    const cause = new Error("Connection reset by peer")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )
    const notification = vi.mocked(actionContext.dialog.notification)
    const reportError = vi.mocked(actionContext.dialog.reportError)
    const errorNotification = vi.mocked(actionContext.dialog.errorNotification)

    const result = await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(result.ok).toBe(true)
    expect(notification).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(errorNotification).not.toHaveBeenCalled()
  })

  test("an insufficient-scope failure offers its remedy in the panel, not a toast", async () => {
    const cause = new InsufficientScopeError("exercise-services")
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )
    const reportError = vi.mocked(actionContext.dialog.reportError)

    await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(reportError).not.toHaveBeenCalled()
    expect(lastView()?.error?.actions).toEqual([{ label: "Log In", command: "tmc.showMoocLogin" }])
  })

  test("an exercise gone from the server says so and offers a refresh", async () => {
    const cause = new ExerciseNotFoundError(
      "This exercise is no longer in the course.",
      "Caused by: HTTP error 404 Not Found for …",
    )
    const actionContext = contextWithWorkspace(
      makeMoocKind(moocCourse),
      { submitMoocExercise: vi.fn().mockResolvedValue(Err(cause)) },
      moocExercise,
    )

    await runForExercise(
      actionContext,
      undefined,
      "Submitting the exercise",
      submitBody(actionContext),
    )

    expect(lastView()).toMatchObject({
      headline: "Submission failed",
      error: {
        message:
          "This exercise is no longer in the course. Refresh the courses to see its exercises.",
        detailsId: expect.any(String),
        actions: [{ label: "Refresh Courses", command: "tmcTreeView.refreshCourses" }],
      },
    })
  })
})

suite("sendSubmissionFeedback action", () => {
  const FEEDBACK_URL = "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback"

  async function submitAskingFeedback(feedbackUrl: string): Promise<ReadyActionContext> {
    viewUpdates.length = 0
    const submitFeedback = vi.fn().mockResolvedValue(Ok({ api_version: 8, status: "ok" }))
    const { actionContext } = contextFor(makeTmcKind(tmcCourse), {
      submitTmcExerciseAndWaitForResults: vi.fn().mockResolvedValue(
        Ok({
          status: "ok",
          all_tests_passed: true,
          points: [],
          test_cases: [],
          feedback_answer_url: feedbackUrl,
          feedback_questions: [{ id: 3, question: "How was it?", kind: "Text" }],
        }),
      ),
      submitSubmissionFeedback: submitFeedback,
    })
    await submitExercise(actionContext, tmcExercise)
    return actionContext
  }

  test("sends the answers to the URL the submission result asked them at", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    const sent = await sendSubmissionFeedback(actionContext, shownPanelId(), [
      { questionId: 3, answer: "Fun" },
    ])

    expect(sent.ok).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).toHaveBeenCalledWith(
      FEEDBACK_URL,
      { status: [{ question_id: 3, answer: "Fun" }] },
    )
  })

  test("shows the panel its feedback as sent", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    await sendSubmissionFeedback(actionContext, shownPanelId(), [{ questionId: 3, answer: "Fun" }])

    expect(lastView()).toMatchObject({ phase: "finished", feedback: { isSent: true } })
  })

  test("refuses a panel whose submission asked nothing", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)

    const sent = await sendSubmissionFeedback(actionContext, -1, [{ questionId: 3, answer: "Fun" }])

    expect(sent.err).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).not.toHaveBeenCalled()
  })

  test("answers each submission's questions once", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()

    await sendSubmissionFeedback(actionContext, panelId, [{ questionId: 3, answer: "Fun" }])
    const second = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "Again" },
    ])

    expect(second.err).toBe(true)
    expect(actionContext.startup.langs.submitSubmissionFeedback).toHaveBeenCalledOnce()
  })

  test("posts once when sent twice before the first send finishes", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()

    const [first, second] = await Promise.all([
      sendSubmissionFeedback(actionContext, panelId, [{ questionId: 3, answer: "Fun" }]),
      sendSubmissionFeedback(actionContext, panelId, [{ questionId: 3, answer: "Fun" }]),
    ])

    expect([first.ok, second.ok]).toEqual([true, false])
    expect(actionContext.startup.langs.submitSubmissionFeedback).toHaveBeenCalledOnce()
  })

  test("a submission of another exercise leaves the earlier questions to answer", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()

    await submitExercise(moocContextWith(grading({})).actionContext, moocExercise)

    const sent = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "Fun" },
    ])
    expect(sent.ok).toBe(true)
  })

  test("a failed send can be retried", async () => {
    const actionContext = await submitAskingFeedback(FEEDBACK_URL)
    const panelId = shownPanelId()
    vi.mocked(actionContext.startup.langs.submitSubmissionFeedback).mockResolvedValueOnce(
      Err(new Error("connection reset")),
    )

    const first = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "a" },
    ])
    const second = await sendSubmissionFeedback(actionContext, panelId, [
      { questionId: 3, answer: "a" },
    ])

    expect(first.err).toBe(true)
    expect(second.ok).toBe(true)
  })
})

suite("a mooc grading left pending across a reload", () => {
  test("is shown as still grading, and Keep Waiting fetches its result", async () => {
    pendingGradings.attach(createMockContext().globalState)
    const { actionContext, wait } = moocContextWith({ status: "no-grading-yet" })
    await submitExercise(actionContext, moocExercise)
    expect(pendingGradings.get(moocExercise.id)?.taskSubmissionId).toBe(TASK_SUBMISSION_ID)
    submissionViews.clear()

    const panel = exerciseResultsPanel(actionContext, moocExercise).unwrap()

    expect(submissionViews.latestFor(moocExercise.id)?.view).toMatchObject({
      headline: "Your latest submission is still being graded",
      canKeepWaiting: true,
    })
    wait.mockResolvedValue(Ok({ status: "grading-hidden" }))
    const waited = await keepWaitingForGrading(actionContext, panel.id)
    expect(waited.ok).toBe(true)
    expect(pendingGradings.get(moocExercise.id)).toBeUndefined()
  })

  test("is dropped when a later submission fails to upload", async () => {
    pendingGradings.attach(createMockContext().globalState)
    await submitExercise(moocContextWith({ status: "no-grading-yet" }).actionContext, moocExercise)
    expect(pendingGradings.get(moocExercise.id)).toBeDefined()

    await submitExercise(moocContextWithErr(new Error("upload failed")).actionContext, moocExercise)

    expect(pendingGradings.get(moocExercise.id)).toBeUndefined()
  })
})

suite("cancelling a mooc submission's upload", () => {
  test("stops the upload and says the submission was cancelled", async () => {
    const { actionContext, submit } = moocContextWith(undefined)
    let finish: (() => void) | undefined
    submit.mockImplementation(
      async (_id: string, _path: string, onInterruptHandle: (interrupt: () => void) => void) => {
        const stopped = new Promise<void>((resolve) => {
          finish = resolve
        })
        onInterruptHandle(() => finish?.())
        await stopped
        return Err(new Error("The TestMyCode tools were stopped."))
      },
    )

    const submitting = submitExercise(actionContext, moocExercise)
    await vi.waitFor(() => expect(finish).toBeDefined())
    const panelId = submissionViews.latestFor(moocExercise.id)!.panel.id
    cancelSubmissionUpload(panelId)
    await submitting

    expect(lastView()).toMatchObject({ headline: "Submission cancelled", tone: "info" })
  })
})
