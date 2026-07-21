import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import type { Organization } from "../shared/langsSchema"
import type { CourseIdentifier } from "../shared/shared"
import { makeTmcKind } from "../shared/shared"
import { Logger } from "../utilities"

// The courses.mooc.fi backend has no organization concept: a student sees only
// the courses they are enrolled in, added through the platform-selection
// webview flow (SelectPlatform -> SelectMoocCourse). This organization-browsing
// quick pick is therefore TMC-only.
export async function addNewCourse(actionContext: ActionContext): Promise<void> {
  const { dialog, langs } = actionContext
  Logger.info("Adding new course")
  if (langs.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const organizationsResult = await langs.val.getTmcOrganizations()
  if (organizationsResult.err) {
    dialog.errorNotification("Failed to fetch organizations.", organizationsResult.val)
    return
  }

  const chosenOrg = await dialog.selectItem<Organization>(
    { title: "Add New Course", placeHolder: "Which organization?" },
    ...organizationsResult.val.map<[string, Organization]>((org) => [org.name, org]),
  )
  if (chosenOrg === undefined) {
    return
  }

  const courses = await langs.val.getCourses(chosenOrg.slug)
  if (courses.err) {
    dialog.errorNotification(`Failed to fetch organization courses for ${chosenOrg.name}.`)
    return
  }
  const chosenCourse = await dialog.selectItem<CourseIdentifier>(
    { title: "Add New Course", placeHolder: "Which course?" },
    ...courses.val.map<[string, CourseIdentifier]>((course) => [
      course.title,
      makeTmcKind({ courseId: course.id }),
    ]),
  )
  if (chosenCourse === undefined) {
    return
  }

  const result = await actions.addNewCourse(actionContext, chosenOrg.slug, chosenCourse)
  if (result.err) {
    dialog.errorNotification("Failed to add course.", result.val)
  }
}
