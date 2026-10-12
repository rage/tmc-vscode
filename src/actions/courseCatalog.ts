import type { Result } from "ts-results"

import type { Course, MoocCourse, Organization } from "../../shared/langsSchema"
import { AuthorizationError } from "../errors"
import type { ReadyActionContext } from "./types"

/**
 * Stands for both "the user is not logged in to courses.mooc.fi" and the pick
 * entry offering to fix that. The device flow is offered here because the
 * "Log In" command is gated on the `LoggedIn` context key, which a tmc token
 * stored before courses.mooc.fi logins satisfies on its own — so for those
 * users this is the only route to a courses.mooc.fi login.
 */
export const MOOC_LOGIN = "mooc-login"

/**
 * Lists the courses.mooc.fi courses the user is enrolled in, or {@link MOOC_LOGIN} when
 * courses.mooc.fi has no session for them. Independent of {@link listTmcOrganizations}, so a
 * picker can show whichever answers first.
 */
export async function listEnrolledMoocCourses(
  actionContext: ReadyActionContext,
): Promise<Result<MoocCourse[], Error> | typeof MOOC_LOGIN> {
  if (!actionContext.authState.loggedIn) {
    return MOOC_LOGIN
  }
  const courses = await actionContext.startup.langs.getEnrolledMoocCourses()
  return courses.err && courses.val instanceof AuthorizationError ? MOOC_LOGIN : courses
}

/** Lists the TMC organizations, the add-course pick's way into TMC courses. */
export async function listTmcOrganizations(
  actionContext: ReadyActionContext,
): Promise<Result<Organization[], Error>> {
  return actionContext.startup.langs.getTmcOrganizations()
}

/** Lists a TMC organization's courses, for the add-course pick's second step. */
export async function listOrganizationCourses(
  actionContext: ReadyActionContext,
  organizationSlug: string,
): Promise<Result<Course[], Error>> {
  return actionContext.startup.langs.getCourses(organizationSlug)
}
