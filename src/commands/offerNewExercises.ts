import { ExerciseIdentifier, LocalCourseData } from "../../shared/lib"
import { downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { NEW_EXERCISES_REMINDER_DELAY } from "../config/constants"
import { shownCourseHome } from "../ui/shownCourseHome"
import { countOf, Logger } from "../utilities"
import { downloadNewExercises } from "./downloadNewExercises"
import { showCourseHomeButton } from "./showCourseHome"

/**
 * Acts on the new exercises a refresh found, as `testMyCode.newExercises` says: asks to download
 * them, downloads them, or leaves them to the course home's notice. Each course's new exercises
 * are acted on once, unless the student asks to be reminded later; a course whose home is on
 * screen gets no notification, as its notice says it.
 */
export function offerNewExercises(
  actionContext: ReadyActionContext,
  courses: readonly LocalCourseData[],
): void {
  const { settings } = actionContext
  const { userData } = actionContext.startup
  const handling = settings.getNewExerciseHandling()
  if (handling === "courseHome") {
    return
  }

  // `notifyAfter` holds back this offer only: gating the refresh on it too would freeze course
  // metadata and point totals for the whole delay, including the refresh each submit asks for.
  const now = Date.now()
  const offered = courses.filter(
    (course) =>
      hasUnofferedNewExercises(course) &&
      !LocalCourseData.isDisabled(course) &&
      !LocalCourseData.isNotEnrolled(course) &&
      LocalCourseData.getAccessLoss(course) === undefined &&
      course.data.notifyAfter <= now,
  )
  for (const course of offered) {
    void userData.setNewExercisesOffered(LocalCourseData.getCourseId(course)).then((recorded) => {
      if (recorded.err) {
        Logger.error("Failed to record the offered new exercises", recorded.val)
      }
    })
  }
  if (handling === "download") {
    void downloadInTurn(actionContext, offered)
    return
  }
  for (const course of offered) {
    askToDownload(actionContext, course)
  }
}

function askToDownload(actionContext: ReadyActionContext, course: LocalCourseData): void {
  const courseId = LocalCourseData.getCourseId(course)
  if (shownCourseHome.isShowing(courseId)) {
    return
  }
  const count = LocalCourseData.getNewExercises(course).length
  void actionContext.dialog.notification(
    `${countOf(count, "new exercise")} in ${LocalCourseData.getCourseTitle(course)}.`,
    ["Download", (): void => void downloadNewExercises(actionContext, courseId)],
    [
      "Later",
      (): void =>
        void actionContext.startup.userData
          .postponeNewExercises(courseId, Date.now() + NEW_EXERCISES_REMINDER_DELAY)
          .then((postponed) => {
            if (postponed.err) {
              Logger.error("Failed to postpone the new exercises", postponed.val)
            }
          }),
    ],
  )
}

/** One course after the other, so that two downloads never compete for the CLI. */
async function downloadInTurn(
  actionContext: ReadyActionContext,
  courses: readonly LocalCourseData[],
): Promise<void> {
  for (const course of courses) {
    const courseId = LocalCourseData.getCourseId(course)
    const title = LocalCourseData.getCourseTitle(course)
    const downloaded = await withOperation(
      actionContext.dialog,
      {
        failure: `Failed to download the new exercises of ${title}.`,
        shownIn: shownCourseHome.failureSink(courseId),
        isBackground: true,
      },
      () => downloadNewExercisesForCourse(actionContext, courseId, "statusBar"),
    )
    const count = downloaded.ok ? downloaded.val.downloaded.length : 0
    if (count > 0 && !shownCourseHome.isShowing(courseId)) {
      void actionContext.dialog.notification(
        `${countOf(count, "new exercise")} downloaded in ${title}.`,
        showCourseHomeButton(courseId),
      )
    }
  }
}

/** Whether the course has new exercises no notification has offered yet. */
function hasUnofferedNewExercises(course: LocalCourseData): boolean {
  const offered = new Set((course.data.offeredNewExercises ?? []).map(String))
  return LocalCourseData.getNewExercises(course).some(
    (id) => !offered.has(ExerciseIdentifier.toString(id)),
  )
}
