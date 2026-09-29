import getFolderSize from "get-folder-size"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { withOperation } from "../../api/withOperation"
import { LocalCourseData, panelTarget } from "../../shared/shared"
import { formatSizeInBytes, Logger } from "../../utilities"
import { panelActions } from "../panelActions"
import type { HandlerMap } from "../router"
import { nextPanelId } from "../routes"

/** The MyCourses screen's messages, and the course actions it shares with CourseDetails. */
export const myCoursesHandlers = {
  requestMyCoursesData: {
    requiresReady: true,
    handle(message, { host, actionContext }): Result<undefined, Error> {
      const target = panelTarget(message.sourcePanel)
      const { userData, resources } = actionContext.startup
      const projectsDirectory = resources.projectsDirectory
      if (!projectsDirectory) {
        const error = new Error(
          "Showing your courses is unavailable: the TestMyCode tools did not report where the exercises folder is.",
        )
        Logger.error(error.message)
        return Err(error)
      }
      host.post({ type: "setMyCourses", target, courses: userData.getCourses() })
      host.post({ type: "setTmcDataPath", target, tmcDataPath: projectsDirectory })
      getFolderSize
        .loose(projectsDirectory)
        .then((size) =>
          host.post({ type: "setTmcDataSize", target, tmcDataSize: formatSizeInBytes(size) }),
        )
        .catch((error: unknown) => {
          Logger.error("Failed to measure the exercise directory", error)
          host.post({ type: "setTmcDataSize", target, tmcDataSize: "unknown" })
        })
      return Ok(undefined)
    },
  },
  openMyCourses: {
    requiresReady: false,
    handle(_message, { host }): void {
      host.render({ id: nextPanelId(), type: "MyCourses" })
    },
  },
  openCourseDetails: {
    requiresReady: false,
    handle(message, { host }): void {
      host.render({ id: nextPanelId(), type: "CourseDetails", courseId: message.courseId })
    },
  },
  removeCourse: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<void> {
      const courseResult = actionContext.startup.userData.getCourse(message.id)
      if (courseResult.err) {
        actionContext.dialog.reportError("Failed to remove the course.", courseResult.val)
        return
      }
      const title = LocalCourseData.getCourseTitle(courseResult.val)
      const isConfirmed = await actionContext.dialog.confirm(`Remove ${title} from your courses?`, {
        confirmLabel: "Remove Course",
        detail: "Your downloaded exercises stay on disk, and you can add the course again later.",
      })
      if (!isConfirmed) {
        return
      }
      const removeResult = await withOperation(
        actionContext.dialog,
        { failure: "Failed to remove the course.", backend: message.id.kind },
        () => panelActions().removeCourse(actionContext, message.id),
      )
      if (removeResult.ok) {
        host.render({ id: nextPanelId(), type: "MyCourses" })
        actionContext.dialog.statusMessage(`Removed ${title}.`)
      }
    },
  },
  openCourseWorkspace: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<void> {
      const courseResult = actionContext.startup.userData.getCourse(message.courseId)
      if (courseResult.err) {
        actionContext.dialog.reportError("Failed to read the course.", courseResult.val)
        return
      }
      await panelActions().openWorkspace(
        actionContext,
        LocalCourseData.getCourseName(courseResult.val),
        message.courseId.kind,
      )
    },
  },
  clearNewExercises: {
    requiresReady: true,
    async handle(message, { actionContext }): Promise<void> {
      const { userData } = actionContext.startup
      await withOperation(
        actionContext.dialog,
        { failure: "Failed to dismiss the new exercises.", backend: message.courseId.kind },
        () => userData.clearFromNewExercises(message.courseId),
      )
    },
  },
  addNewCourse: {
    requiresReady: false,
    async handle(): Promise<void> {
      await vscode.commands.executeCommand("tmc.addNewCourse")
    },
  },
  changeTmcDataPath: {
    requiresReady: false,
    async handle(): Promise<void> {
      await vscode.commands.executeCommand("tmc.changeTmcDataPath")
    },
  },
} satisfies Partial<HandlerMap>
