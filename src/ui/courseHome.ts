import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type {
  CourseHomeExercise,
  CourseHomeView,
  DeadlineText,
  SharedMoocCourseExercise,
} from "../../shared/lib"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  SUBMIT_REFUSAL_ICONS,
  SUBMIT_REFUSAL_LABELS,
  PENDING_REVIEW_ICONS,
  PENDING_REVIEW_LABELS,
  pendingReviewSentence,
  submitRefusalSentence,
} from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { isAiAllowed } from "../api/aiRestriction"
import { installSentence, missingLanguageExtensions } from "../api/languageExtensions"
import {
  findNextDateAfter,
  formatDateTime,
  formatDeadlineBriefly,
  formatNearRelativeTime,
  parseDate,
  PROSE_LOCALE,
} from "../utilities"
import { failedUpdates } from "./failedUpdates"
import { lastExerciseReached } from "./lastExerciseReached"
import { recentPolicyChanges } from "./recentPolicyChanges"
import { recentUpdates } from "./recentUpdates"
import type { ExerciseView, PartView } from "./treeview/courseViewModel"
import {
  buildCourseView,
  isLeftToDo,
  onDiskByCourse,
  shownDeadline,
} from "./treeview/courseViewModel"
import { downloadStatusOf, partLabel } from "./treeview/treeview"
import { updateablesRegistry } from "./updateablesRegistry"

/** The course whose workspace this window is, if it is one of a stored course. */
export function openCourseId({ startup }: ReadyActionContext): CourseIdentifier | undefined {
  const { activeCourse, activeCourseBackend } = startup.workspaceManager
  if (activeCourse === undefined || activeCourseBackend === undefined) {
    return undefined
  }
  const course = startup.userData.getCourseBySlug(activeCourseBackend, activeCourse)
  return course.ok ? LocalCourseData.getCourseId(course.val) : undefined
}

function isOnDisk(exercise: ExerciseView): boolean {
  return exercise.status === "opened" || exercise.status === "closed"
}

function courseView(
  { startup }: ReadyActionContext,
  course: LocalCourseData,
  now: Date,
): PartView[] {
  return buildCourseView(course, {
    onDisk: onDiskByCourse(startup.workspaceManager.getExercises())(course),
    downloadStatusOf,
    updateable: updateablesRegistry.get(LocalCourseData.getCourseId(course)),
    isRemoved: (id) => updateablesRegistry.isRemoved(id),
    now,
  })
}

function exerciseToContinueIn(exercises: ExerciseView[]): ExerciseView | undefined {
  const leftToDo = exercises.filter((ex) => isLeftToDo(ex))
  return leftToDo.find((ex) => isOnDisk(ex)) ?? leftToDo[0]
}

/**
 * The exercise the course home's Continue opens: the first left to do that is on disk, else the
 * first left to do. `undefined` when nothing is left.
 */
export function exerciseToContinue(
  actionContext: ReadyActionContext,
  course: LocalCourseData,
  now = new Date(),
): ExerciseIdentifier | undefined {
  return exerciseToContinueIn(courseView(actionContext, course, now).flatMap((x) => x.exercises))
    ?.id
}

/**
 * What the course home shows of a stored course, from the state the Courses view is drawn from.
 *
 * @param now The instant deadlines are judged and described against.
 */
export function buildCourseHomeView(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  now = new Date(),
): Result<CourseHomeView, Error> {
  const { userData } = actionContext.startup
  const stored = userData.getCourse(courseId)
  if (stored.err) {
    return stored
  }
  const course = stored.val
  const locale = PROSE_LOCALE
  const parts = courseView(actionContext, course, now)
  const exercises = parts.flatMap((part) => part.exercises)
  const deadlineText = (date: Date | null): DeadlineText | undefined =>
    date
      ? {
          at: date.toISOString(),
          absolute: formatDateTime(date, locale),
          relative: formatNearRelativeTime(date, now, locale) ?? null,
          brief: formatDeadlineBriefly(date, now, locale),
        }
      : undefined
  const newKeys = new Set(
    LocalCourseData.getNewExercises(course).map((id) => ExerciseIdentifier.key(id)),
  )
  const nextExercise = exerciseToContinueIn(exercises)
  const openCourse = openCourseId(actionContext)
  const isWorkspaceOpen = openCourse !== undefined && CourseIdentifier.equals(openCourse, courseId)

  return Ok({
    backend: course.kind,
    title: course.data.title,
    organization: course.data.organization,
    ...courseRunFields(course, locale),
    description: examNote(course, locale) ?? (course.data.description || null),
    materialUrl: LocalCourseData.getMaterialUrl(course) ?? null,
    awardedPoints: course.data.awardedPoints,
    availablePoints: course.data.availablePoints,
    // Nothing can be submitted to a course its backend refuses, so no deadline is ahead.
    nextDeadline: LocalCourseData.getAccessLoss(course)
      ? undefined
      : deadlineText(
          findNextDateAfter(
            now,
            parts.map((part) => part.nextDeadline),
          ),
        ),
    hasSoftDeadlines: exercises.some((ex) => !ex.isHard),
    isExamMode: LocalCourseData.isExamMode(course),
    isDisabled: LocalCourseData.isDisabled(course),
    isNotEnrolled: LocalCourseData.isNotEnrolled(course),
    accessLoss: LocalCourseData.getAccessLoss(course) ?? null,
    isOffline: !actionContext.coursesTree.isBackendReachable(course.kind),
    aiPolicy:
      course.kind === "mooc"
        ? { policy: course.data.aiPolicy, isAiAllowed: isAiAllowed(course) }
        : null,
    isLoggedIn: actionContext.authState.loggedIn,
    isSessionExpired: actionContext.authState.isSessionExpired,
    isWorkspaceOpen,
    isRestricted: isWorkspaceOpen && !vscode.workspace.isTrusted,
    ...(nextExercise
      ? {
          nextExercise: {
            id: nextExercise.id,
            name: nextExercise.name,
            isOnDisk: isOnDisk(nextExercise),
          },
        }
      : {}),
    isAllDone: exercises.length > 0 && nextExercise === undefined,
    hasReachedLastExercise: lastExerciseReached.has(courseId),
    newExercises: exercises
      .filter((ex) => ex.status === "new" && newKeys.has(ExerciseIdentifier.key(ex.id)))
      .map(({ id, name }) => ({ id, name })),
    updates: exercises.filter((ex) => ex.isUpdateable).map(({ id, name }) => ({ id, name })),
    failedUpdates: failedUpdates
      .all()
      .filter((failed) => CourseIdentifier.equals(failed.courseId, courseId))
      .map(({ exerciseId, exerciseName, reason }) => ({
        id: exerciseId,
        name: exerciseName,
        reason,
      })),
    aiPolicyChange: recentPolicyChanges.get(course) ?? null,
    recentlyUpdated: recentUpdates.get(courseId),
    missingLanguageExtensions: missingLanguageExtensions(
      actionContext.startup.workspaceManager
        .getExercises()
        .filter((exercise) => CourseIdentifier.equals(exercise.courseId, courseId))
        .map((exercise) => exercise.uri.fsPath),
    ).map((extension) => ({
      extensionId: extension.extensionId,
      installSentence: installSentence(extension),
    })),
    parts: parts.map((part) => ({
      key: part.key,
      name: part.isUngrouped
        ? parts.length === 1
          ? "Exercises"
          : "Other exercises"
        : partLabel(part.name),
      isDefaultOpen: part.isDefaultOpen,
      ...(part.opensAt
        ? {
            locked: {
              reason:
                `Opens on ${formatDateTime(part.opensAt, locale)}. Until then its exercises` +
                " can be tested but not submitted.",
              icon: SUBMIT_REFUSAL_ICONS.chapterNotOpenYet,
            },
          }
        : part.lockingStatus === "NotUnlockedYet"
          ? {
              locked: {
                reason: "Complete earlier chapters first.",
                icon: SUBMIT_REFUSAL_ICONS.chapterNotUnlockedYet,
              },
            }
          : part.lockingStatus === "CompletedAndLocked"
            ? {
                locked: {
                  reason: "This chapter is locked.",
                  icon: SUBMIT_REFUSAL_ICONS.chapterCompletedAndLocked,
                },
              }
            : {}),
      exercises: part.exercises.map((ex) => {
        const deadline = deadlineText(shownDeadline(ex))
        const { materialUrl, pendingReview, solutionUrl, submitRefusal, triesLeft } = ex
        return {
          id: ex.id,
          name: ex.name,
          status: ex.status,
          passed: ex.passed,
          isOutOfTries: ex.isOutOfTries,
          ...(triesLeft === undefined ? {} : { triesLeft }),
          ...(submitRefusal
            ? {
                submitRefusal: isLockedForReview(ex.mooc, submitRefusal)
                  ? {
                      label: "in review",
                      sentence: REVIEWING_STAGE_NOTES[ex.mooc?.reviewingStage ?? ""] ?? "",
                      icon: SUBMIT_REFUSAL_ICONS[submitRefusal],
                    }
                  : {
                      label: SUBMIT_REFUSAL_LABELS[submitRefusal],
                      sentence: submitRefusalSentence(submitRefusal, ex.slug, part.name),
                      icon: SUBMIT_REFUSAL_ICONS[submitRefusal],
                    },
              }
            : {}),
          awardedPoints: ex.awardedPoints,
          availablePoints: ex.availablePoints,
          ...(pendingReview
            ? {
                pendingReview: {
                  label: PENDING_REVIEW_LABELS[pendingReview],
                  sentence: pendingReviewSentence(pendingReview, ex.awardedPoints),
                  icon: PENDING_REVIEW_ICONS[pendingReview],
                },
              }
            : {}),
          ...(deadline ? { deadline } : {}),
          isSoftDeadline: !ex.isHard,
          isUpdateable: ex.isUpdateable,
          ...(materialUrl ? { materialUrl } : {}),
          ...(solutionUrl ? { solutionUrl } : {}),
          ...reviewFields(ex.mooc, locale),
          ...(ex.mooc?.instructions ? { instructions: ex.mooc.instructions } : {}),
        }
      }),
    })),
  })
}

/** What a mooc course's language, run and the student's role add to its course home. */
function courseRunFields(
  course: LocalCourseData,
  locale: string,
): Pick<CourseHomeView, "languageCode" | "endedNote" | "successor" | "isStaff"> {
  if (course.kind !== "mooc") {
    return {}
  }
  const { languageCode, closedAt, successorCourseId, isStaff } = course.data
  const endedAt = closedAt ? parseDate(closedAt) : null
  const hasEnded = endedAt !== null && endedAt.getTime() <= Date.now()
  return {
    ...(languageCode ? { languageCode } : {}),
    ...(hasEnded ? { endedNote: `This course ended on ${formatDateTime(endedAt, locale)}.` } : {}),
    ...(successorCourseId ? { successor: { courseId: successorCourseId } } : {}),
    ...(isStaff ? { isStaff: true } : {}),
  }
}

const REVIEWING_STAGE_NOTES: Record<string, string> = {
  peer_review: "Give peer reviews on the course page to finish this exercise.",
  self_review: "Review your own answer on the course page to finish this exercise.",
  waiting_for_peer_reviews: "Your answer is waiting for other students to review it.",
  waiting_for_teacher: "Your answer is waiting for a teacher to review it.",
  reviewed_and_locked: "Your answer has been reviewed. The exercise takes no more answers.",
  locked: "The exercise takes no more answers.",
  not_answered_and_locked: "The exercise closed without an answer from you.",
}

const TEACHER_DECISIONS: Record<string, string> = {
  zero_points: "no points",
  custom_points: "points given by the teacher",
  suspected_plagiarism: "suspected plagiarism",
  unauthorized_ai_use: "unauthorized AI use",
  bad_answer: "the answer was not accepted",
  other: "other",
  reject_and_reset: "rejected; answer again",
}

/** A mooc exercise's review stage and a teacher's review, as the course home words them. */
function reviewFields(
  exercise: SharedMoocCourseExercise | undefined,
  locale: string,
): Pick<CourseHomeExercise, "reviewNote" | "teacherReview"> {
  const note = exercise?.reviewingStage ? REVIEWING_STAGE_NOTES[exercise.reviewingStage] : undefined
  const review = exercise?.teacherReview
  const reviewedAt = review ? parseDate(review.createdAt) : null
  const decision = review ? TEACHER_DECISIONS[review.decision] : undefined
  return {
    ...(note ? { reviewNote: note } : {}),
    ...(review
      ? {
          teacherReview: {
            sentence:
              `A teacher reviewed your answer${reviewedAt ? ` on ${formatDateTime(reviewedAt, locale)}` : ""}` +
              `: ${review.scoreGiven} ${review.scoreGiven === 1 ? "point" : "points"}` +
              `${decision ? `, ${decision}` : ""}.`,
            justification: review.justification,
          },
        }
      : {}),
  }
}

/** When a stored exam's answers close, as its course home's description. */
function examNote(course: LocalCourseData, locale: string): string | undefined {
  const closesAt =
    course.kind === "mooc" && course.data.examAnswerableUntil
      ? parseDate(course.data.examAnswerableUntil)
      : null
  return closesAt
    ? `An exam. Its answers close on ${formatDateTime(closesAt, locale)}; results show after that.`
    : undefined
}

const STAGES_IN_REVIEW = new Set([
  "peer_review",
  "self_review",
  "waiting_for_peer_reviews",
  "waiting_for_teacher",
])

/** A review in progress, not a teacher, is what stops more answers to the exercise. */
function isLockedForReview(
  exercise: SharedMoocCourseExercise | undefined,
  refusal: string,
): boolean {
  return (
    refusal === "exerciseLocked" &&
    exercise?.reviewingStage !== undefined &&
    STAGES_IN_REVIEW.has(exercise.reviewingStage)
  )
}
