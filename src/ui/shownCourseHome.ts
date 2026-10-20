import type { CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../shared/lib"

/**
 * The course whose course home is on screen, if any, so news about that course goes into the
 * page instead of a notification. The main panel keeps it current.
 */
class ShownCourseHome {
  private _courseId: CourseIdentifier | undefined

  public set(courseId: CourseIdentifier | undefined): void {
    this._courseId = courseId
  }

  public isShowing(courseId: CourseIdentifier): boolean {
    return this._courseId !== undefined && CourseIdentifierNs.equals(this._courseId, courseId)
  }
}

export const shownCourseHome = new ShownCourseHome()
