import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { CourseIdentifier } from "../../shared/lib"
import { NotEnrolledError } from "../errors"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * Records on a stored mooc course whether a call about it showed the student not enrolled on
 * it, so the course home can say so: a `NotEnrolledError` marks the course, a call that
 * succeeded clears the mark, and any other error leaves it alone. Does nothing for tmc.
 *
 * A 404 is no sign of lost access: courses.mooc.fi answers it for a single exercise it does not
 * serve to clients, such as an exam's. A 403 is not either, as tmc-langs reports every mooc 403
 * as an insufficient scope.
 *
 * @param error Why the call failed; `undefined` when it succeeded.
 */
export async function recordMoocEnrollment(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  error: Error | undefined,
): Promise<Result<void, Error>> {
  const { userData } = actionContext.startup
  const stored = userData.getCourse(courseId)
  if (stored.err || stored.val.kind !== "mooc") {
    return Ok.EMPTY
  }
  if (error !== undefined && !(error instanceof NotEnrolledError)) {
    return Ok.EMPTY
  }
  const course = stored.val.data
  const isNotEnrolled = error !== undefined
  if ((course.notEnrolled ?? false) === isNotEnrolled) {
    return Ok.EMPTY
  }
  Logger.info(`${course.name}: ${isNotEnrolled ? "not enrolled" : "enrolled again"}`)
  const { notEnrolled: _previous, ...rest } = course
  return userData.replaceCourse({
    kind: "mooc",
    data: isNotEnrolled ? { ...rest, notEnrolled: true } : rest,
  })
}
