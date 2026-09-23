import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type Langs from "../api/langs"
import { shownInPanel } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { SUBMIT_PROCESS_TIMEOUT } from "../config/constants"
import { nextPanelId, TmcPanel } from "../panels/TmcPanel"
import type {
  BackendKind,
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSubmissionPanel,
  TargetedExtensionToWebview,
  TargetPanel,
} from "../shared/shared"
import {
  backendName,
  LocalCourseData,
  LocalCourseExercise,
  match,
  panelTarget,
  toWebviewError,
} from "../shared/shared"
import { Logger, parseFeedbackQuestion, runSingleFlight } from "../utilities"
import type { ReadyActionContext } from "./types"

/** What a backend answered a submission with, reduced to what the shared flow acts on. */
interface SubmissionOutcome {
  /** Whether the backend graded the submission as passed, which is then recorded locally. */
  passed: boolean
  /** Shows the panel what the backend answered; the two backends answer different shapes. */
  resultMessage: TargetedExtensionToWebview<"ExerciseSubmission">
}

/**
 * Sends one exercise to its backend and waits for the grading, reporting progress to `target`.
 *
 * @param exercisePath The local exercise directory to pack and send.
 */
type ExerciseSubmitter = (
  target: TargetPanel<ExerciseSubmissionPanel>,
  exercisePath: string,
) => Promise<Result<SubmissionOutcome, Error>>

function tmcSubmitter(langs: Langs, exerciseId: number): ExerciseSubmitter {
  return async (target, exercisePath) => {
    const submission = await langs.submitTmcExerciseAndWaitForResults(
      exerciseId,
      exercisePath,
      (fraction, message) => {
        TmcPanel.postMessage({ type: "submissionStatusUpdate", target, fraction, message })
      },
      (url) => {
        TmcPanel.postMessage({ type: "submissionStatusUrl", target, url })
      },
    )
    if (submission.err) {
      return submission
    }
    const result = submission.val
    const outcome: SubmissionOutcome = {
      passed: result.status === "ok" && result.all_tests_passed === true,
      resultMessage: {
        type: "submissionResult",
        target,
        result,
        questions: result.feedback_questions
          ? parseFeedbackQuestion(result.feedback_questions)
          : [],
      },
    }
    return Ok(outcome)
  }
}

/**
 * Mooc grading has no per-test breakdown or feedback questions, so the panel shows only the
 * overall grading progress, score and feedback text.
 */
function moocSubmitter(langs: Langs, exerciseId: string): ExerciseSubmitter {
  return async (target, exercisePath) => {
    const submission = await langs.submitMoocExerciseAndWaitForResults(
      exerciseId,
      exercisePath,
      (fraction, message) => {
        TmcPanel.postMessage({ type: "submissionStatusUpdate", target, fraction, message })
      },
    )
    if (submission.err) {
      return submission
    }
    const status = submission.val
    const outcome: SubmissionOutcome = {
      passed:
        status.status === "grading" &&
        status.grading.grading_progress === "FullyGraded" &&
        status.grading.score_given !== null &&
        status.grading.score_given > 0,
      resultMessage: { type: "moocSubmissionResult", target, result: status },
    }
    return Ok(outcome)
  }
}

/**
 * Picks the submit call for `backend`, or `undefined` when `exerciseId` is not the kind of
 * id that backend uses, which means the stored course and the exercise disagree.
 */
function submitterFor(
  langs: Langs,
  backend: BackendKind,
  exerciseId: ExerciseIdentifier,
): ExerciseSubmitter | undefined {
  return match(
    exerciseId,
    (tmc) => (backend === "tmc" ? tmcSubmitter(langs, tmc.tmcExerciseId) : undefined),
    (mooc) => (backend === "mooc" ? moocSubmitter(langs, mooc.moocExerciseId) : undefined),
  )
}

/**
 * Submits an exercise to the backend it belongs to and shows the grading in a side panel.
 *
 * Records the exercise as passed locally when the backend graded it so. Returns the
 * exercise's course id on success, so the caller can refresh that course's totals. A
 * submit or paste already in flight for the same exercise makes this a `BottleneckError`.
 */
export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<CourseIdentifier, Error>> {
  const { dialog } = actionContext
  const { exerciseDecorationProvider, langs, userData } = actionContext.startup
  Logger.info(`Submitting exercise ${exercise.exerciseSlug} to ${backendName(exercise.backend)}`)

  const courseResult = userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercise = LocalCourseData.getExercises(course).find(
    (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
  )
  if (!courseExercise) {
    return Err(
      new Error(`ID for exercise ${exercise.courseSlug}/${exercise.exerciseSlug} was not found.`),
    )
  }
  const submit = submitterFor(langs, exercise.backend, LocalCourseExercise.getId(courseExercise))
  if (!submit) {
    return Err(
      new Error(`${exercise.exerciseSlug} is not a ${backendName(exercise.backend)} exercise.`),
    )
  }

  // Key shared with the paste actions, which must not overlap a submit of the same exercise.
  // Held only until the result is posted: the panel offers Paste from that point on, and
  // the command layer's post-submit refresh doesn't need the same protection.
  const exercisePath = exercise.uri.fsPath
  const submitted = await runSingleFlight(
    {
      key: `submit:${exercisePath}`,
      maxHoldMs: SUBMIT_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
    },
    async () => {
      const panel: ExerciseSubmissionPanel = {
        id: nextPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
      }
      TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      const target = panelTarget(panel)

      const outcome = await submit(target, exercisePath)
      if (outcome.err) {
        TmcPanel.postMessage({
          type: "submissionStatusError",
          target,
          error: toWebviewError(outcome.val),
        })
        return shownInPanel(outcome.val)
      }

      if (outcome.val.passed) {
        const passedResult = await userData.setExerciseAsPassed(
          exercise.backend,
          exercise.courseSlug,
          exercise.exerciseSlug,
        )
        if (passedResult.err) {
          dialog.reportError(
            "Failed to record the exercise as passed.",
            passedResult.val,
            exercise.backend,
          )
        } else {
          exerciseDecorationProvider.updateDecorationsForExercises(exercise)
        }
      }

      if (TmcPanel.sidePanel === undefined) {
        TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      }
      TmcPanel.postMessage(outcome.val.resultMessage)

      return Ok.EMPTY
    },
  )
  if (submitted.err) {
    return submitted
  }

  return Ok(LocalCourseData.getCourseId(course))
}
