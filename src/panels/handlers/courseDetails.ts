import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"

import type {
  CourseDetailsPanel,
  CourseHomeAction,
  CourseHomeExerciseAction,
  CourseHomeView,
  ExerciseIdentifier,
} from "../../../shared/lib"
import { assertUnreachable, CourseIdentifier, LocalCourseData } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { installLanguageExtension, languageExtensionById } from "../../api/languageExtensions"
import type { FailureSink } from "../../api/withOperation"
import { reportFailureIn, withOperation } from "../../api/withOperation"
import { MOOC_BACKEND_URL, TMC_BACKEND_URL } from "../../config/constants"
import { isSessionLost } from "../../errors"
import { buildCourseHomeView } from "../../ui/courseHome"
import { showExerciseSourceFile } from "../../ui/exerciseSourceFile"
import { recentPolicyChanges } from "../../ui/recentPolicyChanges"
import { recentUpdates } from "../../ui/recentUpdates"
import { closeCompletedExercises, openCourseExercises } from "../../ui/treeview/treeCommands"
import { Logger, openWebLink } from "../../utilities"
import type { HandlerMap, PanelHost } from "../router"
import { screenFailureSink } from "../screenFailures"

/** The course home does each download's progress itself, so the notification is left out. */
const PROGRESS_PLACE = "coursesView"

/** The CourseDetails screen's messages. */
export const courseDetailsHandlers = {
  requestCourseDetailsData: {
    requiresReady: true,
    handle(message, { actionContext }): Result<CourseHomeView, Error> {
      const view = buildCourseHomeView(actionContext, message.sourcePanel.courseId)
      if (view.err) {
        Logger.error("Failed to read the course.", view.val)
      }
      return view
    },
  },
  refreshCourseDetails: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<CourseHomeView, Error>> {
      const route = shownCourseDetails(host, message.sourcePanel.id)
      if (!route) {
        return Err(new Error("This panel no longer shows a course."))
      }
      const { courseId } = route
      // Silent: the panel that asked shows the failure, remedies included.
      const updateResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to update course.", silent: true },
        () => actions.updateCourse(actionContext, courseId),
      )
      // The panel that asked is on screen, so its notice is the whole announcement.
      if (updateResult.ok && updateResult.val.aiPolicyChange) {
        recentPolicyChanges.addChangeOf(updateResult.val.aiPolicyChange.course)
      }
      // `updateCourse` does not rescan, and a course update can drop exercises still on disk.
      const rescanResult = await actions.refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      // A teacher's change to a downloaded exercise shows as an update only once checked for.
      if (updateResult.ok && updateResult.val.isUpdated) {
        await vscode.commands.executeCommand("tmc.updateExercises", "silent", true)
      }
      if (updateResult.err) {
        actionContext.dialog.noteSessionLost(updateResult.val)
      }
      // Logged out or expired, the view's own notice says so; an error box would only repeat it.
      const { authState } = actionContext
      const isNoticed = !authState.loggedIn || authState.isSessionExpired
      if (updateResult.err && !(isSessionLost(updateResult.val) && isNoticed)) {
        return updateResult
      }
      return buildCourseHomeView(actionContext, courseId)
    },
  },
  courseAction: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const route = shownCourseDetails(host, message.sourcePanel.id)
      if (!route) {
        Logger.warn("Ignoring a course action from a panel that no longer shows a course")
        return
      }
      const shownIn = screenFailureSink(host, route)
      await runCourseAction(actionContext, route.courseId, message.action, shownIn)
    },
  },
  courseExerciseAction: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const route = shownCourseDetails(host, message.sourcePanel.id)
      if (!route) {
        Logger.warn("Ignoring an exercise action from a panel that no longer shows a course")
        return
      }
      // The id comes from the webview, so it may only name an exercise of the course shown.
      const stored = actionContext.startup.userData.getExercise(message.exerciseId)
      if (
        stored.err ||
        !CourseIdentifier.equals(LocalCourseData.getCourseId(stored.val.course), route.courseId)
      ) {
        Logger.warn("Ignoring an exercise action for an exercise of another course")
        return
      }
      const shownIn = screenFailureSink(host, route)
      await runExerciseAction(
        actionContext,
        route.courseId,
        message.exerciseId,
        message.action,
        shownIn,
      )
    },
  },
  installLanguageExtension: {
    requiresReady: true,
    async handle(message): Promise<void> {
      // The id comes from the webview, so it may only name an extension the course home offers.
      const extension = languageExtensionById(message.extensionId)
      if (!extension) {
        Logger.warn("Ignoring an install of an extension the course home does not offer")
        return
      }
      await installLanguageExtension(extension)
    },
  },
  openCourseWorkspace: {
    requiresReady: true,
    async handle(message): Promise<void> {
      // Opening a workspace may ask first, which is the command layer's to do.
      await vscode.commands.executeCommand("tmc.openCourseWorkspace", message.courseId)
    },
  },
} satisfies Partial<HandlerMap>

async function runCourseAction(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  action: CourseHomeAction,
  shownIn: FailureSink,
): Promise<void> {
  const { dialog } = actionContext
  switch (action) {
    case "downloadAllExercises":
    case "downloadNewExercises": {
      const view = buildCourseHomeView(actionContext, courseId)
      if (view.err) {
        return
      }
      // As the Download All command does: only what can still be submitted.
      const ids =
        action === "downloadNewExercises"
          ? view.val.newExercises.map(({ id }) => id)
          : view.val.parts
              .flatMap((part) => part.exercises)
              .filter((ex) => ex.status === "missing" || ex.status === "new")
              .map(({ id }) => id)
      await withOperation(dialog, { failure: "Failed to download the exercises.", shownIn }, () =>
        actions.downloadCourseExercises(actionContext, courseId, ids, PROGRESS_PLACE),
      )
      return
    }
    case "dismissNewExercises":
      await withOperation(
        dialog,
        { failure: "Failed to dismiss the new exercises.", shownIn },
        () => actionContext.startup.userData.clearFromNewExercises(courseId),
      )
      return
    case "updateExercises": {
      const view = buildCourseHomeView(actionContext, courseId)
      if (view.ok) {
        const updates = view.val.updates.map(({ id }) => ({ courseId, exerciseId: id }))
        await withOperation(
          dialog,
          { failure: "Failed to update exercises.", shownIn },
          async () => {
            const downloaded = await actions.downloadExerciseUpdates(
              actionContext,
              updates,
              false,
              PROGRESS_PLACE,
            )
            // The updates notice lists the exercises that failed, with why and Try Again.
            return downloaded.map(({ warnings }) => ({
              warnings: warnings.filter((warning) => !warning.failedExercises),
            }))
          },
        )
      }
      return
    }
    case "dismissRecentUpdates":
      recentUpdates.dismiss(courseId)
      return
    case "dismissAiPolicyChange":
      recentPolicyChanges.dismiss(courseId)
      return
    case "closeCompletedExercises":
      await closeCompletedExercises(actionContext, courseId)
      return
    case "switchCourseWorkspace":
      await vscode.commands.executeCommand("tmc.switchWorkspace")
      return
    case "revealInCoursesView":
      await actionContext.coursesTree.revealCourse(courseId)
      return
    case "findCourseOnline":
      await openWebLink(courseSearchUrl(actionContext, courseId))
      return
    case "removeCourse":
      // Asks first, which is the command layer's to do.
      await vscode.commands.executeCommand("tmc.removeCourse", courseId)
      return
    default:
      assertUnreachable(action)
  }
}

/**
 * Where the student can look for a course on its backend's site: its material, unless the course
 * is gone and the material with it; then the site's front page.
 */
function courseSearchUrl({ startup }: ReadyActionContext, courseId: CourseIdentifier): string {
  const siteUrl = courseId.kind === "mooc" ? MOOC_BACKEND_URL : TMC_BACKEND_URL
  const course = startup.userData.getCourse(courseId)
  if (course.err || LocalCourseData.getAccessLoss(course.val) === "notFound") {
    return siteUrl
  }
  return LocalCourseData.getMaterialUrl(course.val) ?? siteUrl
}

async function runExerciseAction(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  exerciseId: ExerciseIdentifier,
  action: CourseHomeExerciseAction,
  shownIn: FailureSink,
): Promise<void> {
  const { workspaceManager } = actionContext.startup
  switch (action) {
    case "open": {
      await openCourseExercises(actionContext, courseId, [exerciseId], PROGRESS_PLACE, shownIn)
      const exercise = workspaceManager.getExercise(exerciseId)
      if (exercise) {
        await showExerciseSourceFile(actionContext, exercise)
      }
      return
    }
    case "download":
      await withOperation(
        actionContext.dialog,
        { failure: "Failed to download the exercise.", shownIn },
        () =>
          actions.downloadCourseExercises(actionContext, courseId, [exerciseId], PROGRESS_PLACE),
      )
      return
    case "reset":
    case "downloadOldSubmission": {
      const exercise = workspaceManager.getExercise(exerciseId)
      if (!exercise) {
        reportFailureIn(actionContext.dialog, shownIn, "This exercise is not downloaded.")
        return
      }
      // Both confirm first, which is the command layer's to do.
      await vscode.commands.executeCommand(
        action === "reset" ? "tmc.resetExercise" : "tmc.downloadOldSubmission",
        exercise.uri,
      )
      return
    }
    default:
      assertUnreachable(action)
  }
}

/** The course home `host` shows, if it is still panel `id`. */
function shownCourseDetails(host: PanelHost, id: number): CourseDetailsPanel | undefined {
  const route = host.route
  return route?.type === "CourseDetails" && route.id === id ? route : undefined
}
