import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import { shownInPanel, withOperation } from "../../api/withOperation"
import { CLI_PROCESS_TIMEOUT } from "../../config/constants"
import { ConnectionError } from "../../errors"
import type {
  CourseDetailsPanel,
  LocalCourseData as LocalCourseDataType,
  TargetPanel,
} from "../../shared/shared"
import { CourseIdentifier, LocalCourseData, panelTarget } from "../../shared/shared"
import { Logger, runSingleFlight } from "../../utilities"
import {
  buildCourseDetailsView,
  type CourseDetailsView,
  withInFlightStatuses,
} from "../courseDetailsViewModel"
import { exerciseStatusRegistry } from "../exerciseStatusRegistry"
import { panelActions } from "../panelActions"
import type { HandlerMap, PanelHost } from "../router"
import { nextPanelId } from "../routes"
import { updateablesRegistry } from "../updateablesRegistry"

// One CLI download per backend, then a rescan.
const DOWNLOAD_MAX_HOLD_MS = 3 * CLI_PROCESS_TIMEOUT

/** The CourseDetails screen's messages. */
export const courseDetailsHandlers = {
  requestCourseDetailsData: {
    requiresReady: true,
    handle(message, { host, actionContext }): Result<undefined, Error> {
      const courseResult = actionContext.startup.userData.getCourse(message.sourcePanel.courseId)
      if (courseResult.err) {
        Logger.error("Failed to read the course.", courseResult.val)
        return courseResult
      }
      postCourseDetails(host, panelTarget(message.sourcePanel), courseResult.val, actionContext)
      return Ok(undefined)
    },
  },
  refreshCourseDetails: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      const courseId = message.id
      const updateResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to update course.", backend: courseId.kind },
        async () => {
          const updated = await panelActions().updateCourse(actionContext, courseId)
          return updated.err ? shownInPanel(updated.val) : updated
        },
      )
      // `updateCourse` does not rescan, and the statuses pushed below are read straight out
      // of the workspace manager.
      const rescanResult = await panelActions().refreshLocalExercises(actionContext)
      if (rescanResult.err) {
        Logger.warn("Failed to rescan the local exercises", rescanResult.val)
      }
      const course = actionContext.startup.userData.getCourse(courseId)
      if (course.err) {
        return course
      }
      // Pushed to the panel in place: re-rendering it would reset the student's selection,
      // and would drag them back here if they had navigated away.
      const target = courseDetailsShowing(host, courseId)
      if (target) {
        postCourseDetails(host, target, course.val, actionContext)
      }
      return updateResult.err ? updateResult : Ok(undefined)
    },
  },
  downloadExercises: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<void> {
      await withOperation(
        actionContext.dialog,
        { failure: "Failed to download the exercises.", backend: message.courseId.kind },
        () =>
          // A panel re-opened mid-download re-enables its buttons until the statuses
          // arrive, so a second click must not start a second download.
          runSingleFlight(
            {
              key: `download:${message.courseId.kind}:${CourseIdentifier.toString(message.courseId)}`,
              maxHoldMs: DOWNLOAD_MAX_HOLD_MS,
              busyMessage: "This course's exercises are already downloading.",
            },
            async () => {
              await panelActions().downloadExercisesForUi(
                actionContext,
                message.mode,
                message.courseId,
                message.ids,
              )
              return Ok.EMPTY
            },
          ),
      )
    },
  },
  openExercises: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const openResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to open the selected exercises.", backend: message.courseId.kind },
        () => panelActions().downloadAndOpenExercises(actionContext, message.ids, message.courseId),
      )
      const openLimit = openResult.ok ? openResult.val.exceededOpenLimit : undefined
      if (openLimit === undefined) {
        return
      }
      const courseId = message.courseId
      void actionContext.dialog.warningNotification(
        `You have over ${openLimit} exercises open, which can slow VS Code down. Close the ones you have finished in Course Details.`,
        [
          "Open course details",
          (): void => host.renderMain({ id: nextPanelId(), type: "CourseDetails", courseId }),
        ],
      )
    },
  },
  closeExercises: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<void> {
      await withOperation(
        actionContext.dialog,
        { failure: "Failed to close the selected exercises.", backend: message.courseId.kind },
        () => panelActions().closeExercises(actionContext, message.ids, message.courseId),
      )
    },
  },
} satisfies Partial<HandlerMap>

/**
 * Sends a CourseDetails panel everything it renders for `course`, from stored data.
 *
 * The deadlines go out as stored, then are withdrawn by a second `setCourseGroups` if the
 * backend turns out to be unreachable; nothing here waits on the backend.
 */
function postCourseDetails(
  host: PanelHost,
  target: TargetPanel<CourseDetailsPanel>,
  course: LocalCourseDataType,
  actionContext: ReadyActionContext,
): void {
  const courseId = LocalCourseData.getCourseId(course)
  host.post({ type: "setCourseData", target, courseData: course })
  // Deriving this here would mean re-running `checkForExerciseUpdates`, which spawns
  // several CLI processes, so it is answered from what was last posted. Targeted at the
  // requesting panel although the schema is a broadcast one -- `setCourseDisabledStatus`
  // below does the same.
  host.post({
    type: "setUpdateables",
    target,
    courseId,
    exerciseIds: updateablesRegistry.get(courseId),
  })
  host.post({ type: "setCourseDisabledStatus", target, courseId, disabled: course.data.disabled })
  const view = courseDetailsView(course, actionContext, false)
  host.post({
    type: "setExerciseStatuses",
    target,
    courseId,
    statuses: withInFlightStatuses(view.exerciseStatuses, exerciseStatusRegistry.get(courseId)),
  })
  host.post({
    type: "setCourseGroups",
    target,
    offlineMode: false,
    exerciseGroups: view.exerciseGroups,
  })

  // Only an unreachable backend makes the stored deadlines untrustworthy; any other
  // failure leaves them as good as they were.
  actionContext.startup.langs
    .getCourseDetails(courseId)
    .then((apiCourse) => {
      if (apiCourse.err && apiCourse.val instanceof ConnectionError) {
        host.post({
          type: "setCourseGroups",
          target,
          offlineMode: true,
          exerciseGroups: courseDetailsView(course, actionContext, true).exerciseGroups,
        })
      }
    })
    .catch((error: unknown) => {
      // The panel is already rendered, so the only loss is the deadline check; leaving
      // the stored deadlines standing is what an unknown answer means.
      Logger.error("Failed to check whether the backend is reachable", error)
    })
}

/** The panel `host` shows, if it is `courseId`'s CourseDetails. */
function courseDetailsShowing(
  host: PanelHost,
  courseId: CourseIdentifier,
): TargetPanel<CourseDetailsPanel> | undefined {
  const route = host.route
  return route?.type === "CourseDetails" &&
    route.courseId.kind === courseId.kind &&
    CourseIdentifier.toString(route.courseId) === CourseIdentifier.toString(courseId)
    ? panelTarget(route)
    : undefined
}

function courseDetailsView(
  course: LocalCourseDataType,
  actionContext: ReadyActionContext,
  offlineMode: boolean,
): CourseDetailsView {
  return buildCourseDetailsView(
    course,
    actionContext.startup.workspaceManager.getExercises(),
    offlineMode,
    new Date(),
    vscode.env.language,
  )
}
