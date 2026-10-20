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
import { withOperation } from "../../api/withOperation"
import { buildCourseHomeView } from "../../ui/courseHome"
import { showExerciseSourceFile } from "../../ui/exerciseSourceFile"
import { recentUpdates } from "../../ui/recentUpdates"
import { closeCompletedExercises, openCourseExercises } from "../../ui/treeview/treeCommands"
import { Logger } from "../../utilities"
import type { HandlerMap, PanelHost } from "../router"

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
      // `updateCourse` does not rescan, and a course update can drop exercises still on disk.
      const rescanResult = await actions.refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      if (updateResult.err) {
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
      await runCourseAction(actionContext, route.courseId, message.action)
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
      await runExerciseAction(actionContext, route.courseId, message.exerciseId, message.action)
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
      await withOperation(dialog, { failure: "Failed to download the exercises." }, () =>
        actions.downloadCourseExercises(actionContext, courseId, ids, PROGRESS_PLACE),
      )
      return
    }
    case "dismissNewExercises":
      await withOperation(dialog, { failure: "Failed to dismiss the new exercises." }, () =>
        actionContext.startup.userData.clearFromNewExercises(courseId),
      )
      return
    case "updateExercises": {
      const view = buildCourseHomeView(actionContext, courseId)
      if (view.ok) {
        const updates = view.val.updates.map(({ id }) => ({ courseId, exerciseId: id }))
        await withOperation(dialog, { failure: "Failed to update exercises." }, () =>
          actions.downloadExerciseUpdates(actionContext, updates, false, PROGRESS_PLACE),
        )
      }
      return
    }
    case "dismissRecentUpdates":
      recentUpdates.dismiss(courseId)
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
    default:
      assertUnreachable(action)
  }
}

async function runExerciseAction(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  exerciseId: ExerciseIdentifier,
  action: CourseHomeExerciseAction,
): Promise<void> {
  const { workspaceManager } = actionContext.startup
  switch (action) {
    case "open": {
      await openCourseExercises(actionContext, courseId, [exerciseId], PROGRESS_PLACE)
      const exercise = workspaceManager.getExercise(exerciseId)
      if (exercise) {
        await showExerciseSourceFile(actionContext, exercise)
      }
      return
    }
    case "download":
      await withOperation(
        actionContext.dialog,
        { failure: "Failed to download the exercise." },
        () =>
          actions.downloadCourseExercises(actionContext, courseId, [exerciseId], PROGRESS_PLACE),
      )
      return
    case "reset":
    case "downloadOldSubmission": {
      const exercise = workspaceManager.getExercise(exerciseId)
      if (!exercise) {
        void actionContext.dialog.errorNotification("This exercise is not downloaded.")
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
