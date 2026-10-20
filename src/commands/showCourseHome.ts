import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import type { NotificationButton } from "../api/dialog"

/** The one button a notification about a course has: it opens that course's home. */
export function showCourseHomeButton(courseId: CourseIdentifier): NotificationButton {
  return ["Show", (): void => void vscode.commands.executeCommand("tmc.courseDetails", courseId)]
}
