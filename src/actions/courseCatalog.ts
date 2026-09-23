import type { Result } from "ts-results"

import type Langs from "../api/langs"
import type { Course, MoocCourse, Organization } from "../shared/langsSchema"
import type { ReadyActionContext } from "./types"

/**
 * Stands for both "the user is not logged in to courses.mooc.fi" and the pick
 * entry offering to fix that. The device flow is offered here because the
 * "Log In" command is gated on the `LoggedIn` context key, which a still-valid
 * TMC credential satisfies on its own — so for those users this is the only
 * route to a courses.mooc.fi login.
 */
export const MOOC_LOGIN = "mooc-login"

export interface AddableCourses {
  organizations: Result<Organization[], Error>
  moocCourses: Result<MoocCourse[], Error> | typeof MOOC_LOGIN
}

async function enrolledMoocCourses(
  langs: Langs,
  authenticated: boolean,
): Promise<Result<MoocCourse[], Error> | typeof MOOC_LOGIN> {
  return authenticated ? langs.getEnrolledMoocCourses() : MOOC_LOGIN
}

/** Lists what the add-course pick can offer, from both backends at once. */
export async function listAddableCourses(
  actionContext: ReadyActionContext,
): Promise<AddableCourses> {
  const { authState } = actionContext
  const { langs } = actionContext.startup
  const [organizations, moocCourses] = await Promise.all([
    langs.getTmcOrganizations(),
    enrolledMoocCourses(langs, authState.mooc),
  ])
  return { organizations, moocCourses }
}

/** Lists a TMC organization's courses, for the add-course pick's second step. */
export async function listOrganizationCourses(
  actionContext: ReadyActionContext,
  organizationSlug: string,
): Promise<Result<Course[], Error>> {
  return actionContext.startup.langs.getCourses(organizationSlug)
}
