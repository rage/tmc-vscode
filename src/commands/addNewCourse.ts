import type { Result } from "ts-results"
import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import type Langs from "../api/langs"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseInstance, Organization } from "../shared/langsSchema"
import type { CourseIdentifier, Enum } from "../shared/shared"
import { backendName, LocalCourseData, makeMoocKind, makeTmcKind, match } from "../shared/shared"
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

/**
 * Stands for both "the user is not logged in to courses.mooc.fi" and the pick
 * entry offering to fix that. The device flow is offered here because the
 * "Log In" command is gated on the `LoggedIn` context key, which a still-valid
 * TMC credential satisfies on its own — so for those users this is the only
 * route to a courses.mooc.fi login.
 */
const MOOC_LOGIN = "mooc-login"

const TITLE = "Add New Course"

const ALREADY_ADDED = " · already added"

/** Keys a course across both backends, whose id spaces would otherwise collide. */
function courseKey(id: CourseIdentifier): string {
  return match(
    id,
    (tmc) => `tmc:${tmc.courseId}`,
    (mooc) => `mooc:${mooc.instanceId}`,
  )
}

async function enrolledMoocCourses(
  langs: Langs,
  authenticated: boolean,
): Promise<Result<CourseInstance[], Error> | typeof MOOC_LOGIN> {
  return authenticated ? langs.getEnrolledMoocCourseInstances() : MOOC_LOGIN
}

export async function addNewCourse(actionContext: ActionContext): Promise<void> {
  const { authState, dialog, langs, userData } = actionContext
  Logger.info("Adding new course")
  if (langs.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const [organizations, moocCourses] = await Promise.all([
    langs.val.getTmcOrganizations(),
    enrolledMoocCourses(langs.val, authState.mooc),
  ])

  // Courses the user already has are dimmed rather than hidden: a student
  // looking for one would otherwise be left wondering where it went.
  const addedCourses = new Set(
    userData.ok
      ? userData.val.getCourses().map((course) => courseKey(LocalCourseData.getCourseId(course)))
      : [],
  )

  const unavailable: string[] = []
  const choices: [string, TopLevelChoice | typeof MOOC_LOGIN, string][] = []

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

  if (moocCourses === MOOC_LOGIN) {
    choices.push([
      `Log in to ${backendName("mooc")}`,
      MOOC_LOGIN,
      "to list the courses you are enrolled in",
    ])
  } else if (moocCourses.err) {
    unavailable.push(backendName("mooc"))
    Logger.warn(`Failed to fetch ${backendName("mooc")} courses. ${moocCourses.val}`)
  } else {
    for (const course of moocCourses.val) {
      const added = addedCourses.has(courseKey(makeMoocKind({ instanceId: course.id })))
      choices.push([
        course.name,
        makeMoocKind(course),
        `${backendName("mooc")} · ${course.organization_name}${added ? ALREADY_ADDED : ""}`,
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

  const chosen = await dialog.selectItem<TopLevelChoice | typeof MOOC_LOGIN>(
    { title: TITLE, placeHolder },
    ...choices,
  )
  if (chosen === undefined) {
    return
  }
  if (chosen === MOOC_LOGIN) {
    await vscode.commands.executeCommand("tmc.showMoocLogin")
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
        ...courses.val.map<[string, CourseIdentifier, string]>((c) => {
          const id = makeTmcKind({ courseId: c.id })
          const added = addedCourses.has(courseKey(id))
          return [c.title, id, `${backendName("tmc")}${added ? ALREADY_ADDED : ""}`]
        }),
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
    return
  }
  // A My Courses panel renders the list it was last sent, so it has to be told
  // about the course that was just added.
  if (userData.ok) {
    TmcPanel.postMessage({
      type: "setMyCourses",
      target: { type: "MyCourses" },
      courses: userData.val.getCourses(),
    })
  }
}
