import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { CourseHomeView, DeadlineText } from "../../shared/lib"
import {
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseData,
  SUBMIT_REFUSAL_LABELS,
  pendingReviewSentence,
  submitRefusalSentence,
} from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { isAiAllowed } from "../api/aiRestriction"
import {
  findNextDateAfter,
  formatDateTime,
  formatDeadlineBriefly,
  formatNearRelativeTime,
} from "../utilities"
import { recentUpdates } from "./recentUpdates"
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
  const { userData, workspaceManager } = actionContext.startup
  const stored = userData.getCourse(courseId)
  if (stored.err) {
    return stored
  }
  const course = stored.val
  const locale = vscode.env.language
  const parts = buildCourseView(course, {
    onDisk: onDiskByCourse(workspaceManager.getExercises())(course),
    downloadStatusOf,
    updateable: updateablesRegistry.get(courseId),
    isRemoved: (id) => updateablesRegistry.isRemoved(id),
    now,
  })
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
  const nextExercise = exercises.find((ex) => isLeftToDo(ex))
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
    nextDeadline: deadlineText(
      findNextDateAfter(
        now,
        parts.map((part) => part.nextDeadline),
      ),
    ),
    hasSoftDeadlines: exercises.some((ex) => !ex.isHard),
    isExamMode: LocalCourseData.isExamMode(course),
    isDisabled: LocalCourseData.isDisabled(course),
    isNotEnrolled: LocalCourseData.isNotEnrolled(course),
    isOffline: !actionContext.coursesTree.isBackendReachable(course.kind),
    aiPolicy:
      course.kind === "mooc"
        ? { policy: course.data.aiPolicy, isAiAllowed: isAiAllowed(course) }
        : null,
    isLoggedIn: actionContext.authState.loggedIn,
    isSessionExpired: actionContext.authState.isSessionExpired,
    isWorkspaceOpen,
    isRestricted: isWorkspaceOpen && !vscode.workspace.isTrusted,
    ...(nextExercise ? { nextExercise: { id: nextExercise.id, name: nextExercise.name } } : {}),
    newExercises: exercises
      .filter((ex) => ex.status === "new" && newKeys.has(ExerciseIdentifier.key(ex.id)))
      .map(({ id, name }) => ({ id, name })),
    updates: exercises.filter((ex) => ex.isUpdateable).map(({ id, name }) => ({ id, name })),
    recentlyUpdated: recentUpdates.get(courseId),
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
            lockedReason:
              `Opens on ${formatDateTime(part.opensAt, locale)}. Until then its exercises` +
              " can be tested but not submitted.",
          }
        : part.lockingStatus === "NotUnlockedYet"
          ? { lockedReason: "Locked until you have completed the chapters before it." }
          : part.lockingStatus === "CompletedAndLocked"
            ? { lockedReason: "You have completed and locked this chapter." }
            : {}),
      exercises: part.exercises.map((ex) => {
        const deadline = deadlineText(shownDeadline(ex))
        const { materialUrl, pendingReview, submitRefusal, triesLeft } = ex
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
                },
              }
            : {}),
          awardedPoints: ex.awardedPoints,
          availablePoints: ex.availablePoints,
          ...(pendingReview ? { pendingReview: pendingReviewSentence(pendingReview) } : {}),
          ...(deadline ? { deadline } : {}),
          isSoftDeadline: !ex.isHard,
          isUpdateable: ex.isUpdateable,
          ...(materialUrl ? { materialUrl } : {}),
        }
      }),
    })),
  })
}
