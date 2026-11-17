import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { CourseHomeView, DeadlineText } from "../../shared/lib"
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
  const locale = vscode.env.language
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
    description: course.data.description || null,
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
    aiPolicyChange: recentPolicyChanges.get(courseId) ?? null,
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
                submitRefusal: {
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
        }
      }),
    })),
  })
}
