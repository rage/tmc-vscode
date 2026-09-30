import type { Result } from "ts-results"
import * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { separator } from "../api/dialog"
import { withOperation } from "../api/withOperation"
import type { Course, MoocCourse, Organization } from "../shared/langsSchema"
import {
  backendName,
  CourseIdentifier,
  LocalCourseData,
  makeMoocKind,
  makeTmcKind,
} from "../shared/shared"
import { Logger } from "../utilities"

const TITLE = "Add New Course"

/** What accepting a row of the pick does. */
type Choice =
  | { kind: "login" }
  | { kind: "organization"; organization: Organization }
  | { kind: "course"; courseId: CourseIdentifier; name: string; organizationSlug: string }
  | { kind: "added"; courseId: CourseIdentifier }

interface ChoiceItem extends vscode.QuickPickItem {
  choice?: Choice
}

/**
 * A course row. Courses the user already has stay listed rather than hidden, where a
 * student looking for one would wonder where it went, and picking one opens it.
 */
function courseItem(
  courseId: CourseIdentifier,
  name: string,
  organizationSlug: string,
  isAdded: boolean,
  description?: string,
): ChoiceItem {
  const note = isAdded ? "Already added" : undefined
  return {
    label: name,
    description: [description, note].filter(Boolean).join(" · "),
    iconPath: new vscode.ThemeIcon(isAdded ? "check" : "mortar-board"),
    choice: isAdded
      ? { kind: "added", courseId }
      : { kind: "course", courseId, name, organizationSlug },
  }
}

/**
 * Lets the user pick a course from either backend and adds it.
 *
 * courses.mooc.fi lists only the courses the user is enrolled in, so they come first and add in
 * one step. TMC Server hides thousands of courses behind its organizations, so picking one of
 * those opens a second step, with Back, listing its courses. Each backend's rows appear as soon
 * as it answers.
 */
export async function addNewCourse(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  Logger.info("Adding new course")

  const addedCourses = new Set(
    userData
      .getCourses()
      .map((course) => CourseIdentifier.key(LocalCourseData.getCourseId(course))),
  )
  const isAdded = (id: CourseIdentifier): boolean => addedCourses.has(CourseIdentifier.key(id))

  const chosen = await pickCourse(actionContext, isAdded)
  if (!chosen) {
    return
  }
  if (chosen.kind === "login") {
    await vscode.commands.executeCommand("tmc.showMoocLogin")
    return
  }
  if (chosen.kind === "added") {
    await vscode.commands.executeCommand("tmc.courseDetails", chosen.courseId)
    return
  }
  const added = await withOperation(
    dialog,
    {
      failure: "Failed to add course.",
      backend: chosen.courseId.kind,
      progress: `Adding ${chosen.name}…`,
    },
    () => actions.addNewCourse(actionContext, chosen.organizationSlug, chosen.courseId),
  )
  if (added.ok) {
    void dialog.notification(`Added ${chosen.name}.`, [
      "Open Course",
      (): void => void vscode.commands.executeCommand("tmc.courseDetails", chosen.courseId),
    ])
  }
}

/** Runs the pick to a course, a login request, or `undefined` when dismissed. */
function pickCourse(
  actionContext: ReadyActionContext,
  isAdded: (id: CourseIdentifier) => boolean,
): Promise<Exclude<Choice, { kind: "organization" }> | undefined> {
  const { dialog } = actionContext
  const quickPick = vscode.window.createQuickPick<ChoiceItem>()
  quickPick.title = TITLE
  quickPick.matchOnDescription = true
  quickPick.ignoreFocusOut = true

  let moocRows: ChoiceItem[] | undefined
  let tmcRows: ChoiceItem[] | undefined
  const unavailable: string[] = []
  // In display order, not in the order the backends failed.
  const unavailableNames = (): string[] =>
    [backendName("mooc"), backendName("tmc")].filter((name) => unavailable.includes(name))
  let step: 1 | 2 = 1
  // Bumped whenever the shown step changes, so a late listing for a step the user left is dropped.
  let stepGeneration = 0
  const organizationCourses = new Map<string, ReturnType<typeof actions.listOrganizationCourses>>()

  const enterFirstStep = (): void => {
    step = 1
    stepGeneration++
    quickPick.step = undefined
    quickPick.totalSteps = undefined
    quickPick.buttons = []
    quickPick.value = ""
    renderFirstStep()
  }

  /** Redraws the first step's rows without touching the user's filter text. */
  const renderFirstStep = (): void => {
    // Naming the missing backend in the placeholder keeps it visible for as long as the pick
    // is open, so a half-populated list is never mistaken for a complete one.
    quickPick.placeholder =
      unavailable.length === 0
        ? "Search your courses or TMC organizations"
        : `Search your courses or TMC organizations (${unavailableNames().join(" and ")} unavailable)`
    quickPick.items = [
      ...(moocRows?.length
        ? [separator(`${backendName("mooc")} — your courses`), ...moocRows]
        : []),
      ...(tmcRows?.length ? [separator(`${backendName("tmc")} — organizations`), ...tmcRows] : []),
    ]
    quickPick.busy = moocRows === undefined || tmcRows === undefined
  }

  const moocListing = actions.listEnrolledMoocCourses(actionContext).then((listing) => {
    moocRows = moocListingRows(listing, isAdded, unavailable)
  })
  const tmcListing = actions.listTmcOrganizations(actionContext).then((listing) => {
    tmcRows = tmcListingRows(listing, unavailable)
  })

  return new Promise((resolve) => {
    let isSettled = false
    const settle = (choice: Exclude<Choice, { kind: "organization" }> | undefined): void => {
      if (!isSettled) {
        isSettled = true
        resolve(choice)
        quickPick.hide()
      }
    }

    const showOrganization = async (organization: Organization): Promise<void> => {
      step = 2
      const generation = ++stepGeneration
      quickPick.step = 2
      quickPick.totalSteps = 2
      quickPick.buttons = [vscode.QuickInputButtons.Back]
      quickPick.value = ""
      quickPick.placeholder = `Which course in ${organization.name}?`
      quickPick.items = []
      quickPick.busy = true
      let listing = organizationCourses.get(organization.slug)
      if (!listing) {
        listing = actions.listOrganizationCourses(actionContext, organization.slug)
        organizationCourses.set(organization.slug, listing)
      }
      const courses = await listing
      if (generation !== stepGeneration || isSettled) {
        return
      }
      quickPick.busy = false
      if (courses.err) {
        void dialog.reportError(
          `Failed to fetch organization courses for ${organization.name}.`,
          courses.val,
          "tmc",
        )
        settle(undefined)
        return
      }
      quickPick.items = courses.val.map((course: Course) => {
        const id = makeTmcKind({ courseId: course.id })
        return courseItem(id, course.title, organization.slug, isAdded(id), course.name)
      })
    }

    quickPick.onDidAccept(() => {
      const choice = quickPick.selectedItems[0]?.choice
      if (!choice) {
        return
      }
      if (choice.kind === "organization") {
        void showOrganization(choice.organization)
      } else {
        settle(choice)
      }
    })
    quickPick.onDidTriggerButton((button) => {
      if (button === vscode.QuickInputButtons.Back) {
        enterFirstStep()
      }
    })
    quickPick.onDidHide(() => {
      settle(undefined)
      quickPick.dispose()
    })

    const refreshFirstStep = (): void => {
      if (step === 1 && !isSettled) {
        renderFirstStep()
      }
    }
    void moocListing.then(refreshFirstStep)
    void tmcListing.then(refreshFirstStep)
    void Promise.all([moocListing, tmcListing]).then(() => {
      if (step === 1 && !isSettled && quickPick.items.length === 0) {
        void dialog.errorNotification(
          `Failed to fetch courses from ${unavailableNames().join(" or ")}. ` +
            "Check your network connection and that you are logged in.",
        )
        settle(undefined)
      }
    })

    enterFirstStep()
    quickPick.show()
  })
}

function moocListingRows(
  listing: Result<MoocCourse[], Error> | typeof actions.MOOC_LOGIN,
  isAdded: (id: CourseIdentifier) => boolean,
  unavailable: string[],
): ChoiceItem[] {
  if (listing === actions.MOOC_LOGIN) {
    return [
      {
        label: `Log in to ${backendName("mooc")}`,
        description: "to list the courses you are enrolled in",
        iconPath: new vscode.ThemeIcon("sign-in"),
        choice: { kind: "login" },
      },
    ]
  }
  if (listing.err) {
    unavailable.push(backendName("mooc"))
    Logger.warn(`Failed to fetch ${backendName("mooc")} courses.`, listing.val)
    return []
  }
  return listing.val.map((course) => {
    const id = makeMoocKind({ instanceId: course.id })
    // The mooc arm of the action takes the organization from the course it fetches.
    return courseItem(id, course.name, "", isAdded(id), course.organization_name)
  })
}

function tmcListingRows(
  listing: Result<Organization[], Error>,
  unavailable: string[],
): ChoiceItem[] {
  if (listing.err) {
    unavailable.push(backendName("tmc"))
    Logger.warn("Failed to fetch TMC organizations.", listing.val)
    return []
  }
  return listing.val.map((organization) => ({
    label: organization.name,
    description: "Browse courses",
    iconPath: new vscode.ThemeIcon("organization"),
    choice: { kind: "organization", organization },
  }))
}
