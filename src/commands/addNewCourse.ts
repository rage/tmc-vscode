import { Err } from "ts-results"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import type { CourseInstance, Organization } from "../shared/langsSchema"
import type { CourseIdentifier, Enum } from "../shared/shared"
import { backendName, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * What picking a top-level entry means. courses.mooc.fi has no organization
 * concept and only ever returns the courses the user is enrolled in, so a mooc
 * course is addable straight from the first list; TMC Server exposes thousands
 * of courses behind organizations, so its arm can only offer the organizations
 * and needs a second pick. Listing both in one pick keeps the mooc path — the
 * one being migrated to — down to a single step, without a platform question.
 */
type TopLevelChoice = Enum<Organization, CourseInstance>

const TITLE = "Add New Course"

export async function addNewCourse(actionContext: ActionContext): Promise<void> {
  const { dialog, langs } = actionContext
  Logger.info("Adding new course")
  if (langs.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const [organizations, moocCourses] = await Promise.all([
    langs.val.getTmcOrganizations(),
    (async () => {
      const authenticated = await langs.val.isMoocAuthenticated()
      if (authenticated.err) {
        return authenticated
      }
      if (!authenticated.val) {
        return Err(new Error(`Not logged in to ${backendName("mooc")}.`))
      }
      return langs.val.getEnrolledMoocCourseInstances()
    })(),
  ])

  const unavailable: string[] = []
  const choices: [string, TopLevelChoice, string][] = []

  if (organizations.err) {
    unavailable.push(backendName("tmc"))
    Logger.warn("Failed to fetch TMC organizations.", organizations.val)
  } else {
    for (const organization of organizations.val) {
      choices.push([
        organization.name,
        makeTmcKind(organization),
        `${backendName("tmc")} · browse courses`,
      ])
    }
  }

  if (moocCourses.err) {
    unavailable.push(backendName("mooc"))
    Logger.warn(`Failed to fetch ${backendName("mooc")} courses. ${moocCourses.val}`)
  } else {
    for (const course of moocCourses.val) {
      choices.push([
        course.name,
        makeMoocKind(course),
        `${backendName("mooc")} · ${course.organization_name}`,
      ])
    }
  }

  if (choices.length === 0) {
    dialog.errorNotification(
      `Failed to fetch courses from ${unavailable.join(" or ")}. ` +
        "Check your network connection and that you are logged in.",
    )
    return
  }

  // Naming the missing backend in the placeholder keeps it visible for as long
  // as the pick is open, so a half-populated list is never mistaken for a
  // complete one.
  const placeHolder =
    unavailable.length === 0
      ? "Which course or organization?"
      : `Which course or organization? (${unavailable.join(" and ")} unavailable, so its courses are missing)`

  const chosen = await dialog.selectItem<TopLevelChoice>({ title: TITLE, placeHolder }, ...choices)
  if (chosen === undefined) {
    return
  }

  const picked = await match(
    chosen,
    async (organization): Promise<[string, CourseIdentifier] | undefined> => {
      const courses = await langs.val.getCourses(organization.slug)
      if (courses.err) {
        dialog.errorNotification(
          `Failed to fetch organization courses for ${organization.name}.`,
          courses.val,
        )
        return undefined
      }
      const course = await dialog.selectItem<CourseIdentifier>(
        { title: TITLE, placeHolder: `Which course in ${organization.name}?` },
        ...courses.val.map<[string, CourseIdentifier, string]>((c) => [
          c.title,
          makeTmcKind({ courseId: c.id }),
          backendName("tmc"),
        ]),
      )
      return course === undefined ? undefined : [organization.slug, course]
    },
    async (course): Promise<[string, CourseIdentifier] | undefined> =>
      // The mooc arm of the action takes the organization from the course it
      // fetches, so no slug is passed here.
      ["", makeMoocKind({ instanceId: course.id })],
  )
  if (picked === undefined) {
    return
  }

  const result = await actions.addNewCourse(actionContext, picked[0], picked[1])
  if (result.err) {
    dialog.errorNotification("Failed to add course.", result.val)
  }
}
