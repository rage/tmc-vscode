import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type {
  AddCoursePanel,
  CatalogCourse,
  CatalogOrganization,
  MoocCatalog,
  TmcOrganizations,
} from "../../../shared/lib"
import { assertUnreachable, CourseIdentifier, makeMoocKind, makeTmcKind } from "../../../shared/lib"
import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import { withOperation } from "../../api/withOperation"
import { MOOC_BACKEND_URL } from "../../config/constants"
import { AuthorizationError } from "../../errors"
import type { LoginOptions } from "../../ui/loginScreens"
import { Logger, openWebLink } from "../../utilities"
import { showNextWalkthroughStep, walkthroughProgressOf } from "../../window/walkthrough"
import type { HandlerMap, PanelHost } from "../router"

/** The add-course screen's messages. */
export const addCourseHandlers = {
  requestMoocCatalog: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<MoocCatalog, Error>> {
      const panel = shownAddCourse(host, message.sourcePanel.id)
      if (!panel) {
        return Err(NOT_SHOWN)
      }
      const listing = await actions.listEnrolledMoocCourses(actionContext)
      if (listing === actions.MOOC_DISABLED) {
        return Ok({ kind: "disabled" })
      }
      if (listing === actions.MOOC_LOGIN) {
        return Ok({ kind: "loggedOut" })
      }
      if (listing.err) {
        Logger.warn("Failed to list the courses.mooc.fi courses", listing.val)
        return listing
      }
      const items = listing.val.map((course) =>
        catalogCourse(actionContext, panel, {
          // The mooc arm of `addNewCourse` takes the organization from the course it fetches.
          id: makeMoocKind({ moocCourseId: course.id }),
          organizationSlug: "",
          name: course.name,
          organization: course.organization_name,
          description: course.description,
          ...(course.language_code ? { languageCode: course.language_code } : {}),
          ...(course.is_staff ? { isStaff: true } : {}),
        }),
      )
      return Ok({ kind: "listed", items })
    },
  },
  requestTmcOrganizations: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<TmcOrganizations, Error>> {
      const panel = shownAddCourse(host, message.sourcePanel.id)
      if (!panel) {
        return Err(NOT_SHOWN)
      }
      const listing = await actions.listTmcOrganizations(actionContext)
      if (listing.err) {
        if (listing.val instanceof AuthorizationError) {
          return Ok({ kind: "loggedOut" })
        }
        Logger.warn("Failed to list the TMC organizations", listing.val)
        return listing
      }
      // The ones the TMC server pins are its most used.
      const sorted = listing.val.toSorted((a, b) => Number(b.pinned) - Number(a.pinned))
      const items = sorted.map(
        (organization): CatalogOrganization => ({
          slug: organization.slug,
          name: organization.name,
          ...optionalDescription(organization.information),
        }),
      )
      catalogOf(panel.id).organizations = new Map(items.map((item) => [item.slug, item.name]))
      return Ok({ kind: "listed", items })
    },
  },
  requestTmcCourses: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<CatalogCourse[], Error>> {
      const panel = shownAddCourse(host, message.sourcePanel.id)
      if (!panel) {
        return Err(NOT_SHOWN)
      }
      const { organizationSlug } = message
      const organization = catalogOf(panel.id).organizations.get(organizationSlug)
      if (organization === undefined) {
        return Err(new Error("That organization is no longer listed here."))
      }
      const listing = await actions.listOrganizationCourses(actionContext, organizationSlug)
      if (listing.err) {
        Logger.warn(`Failed to list the courses of ${organizationSlug}`, listing.val)
        return listing
      }
      return Ok(
        listing.val.map((course) =>
          catalogCourse(actionContext, panel, {
            id: makeTmcKind({ courseId: course.id }),
            organizationSlug,
            name: course.title,
            organization,
            description: course.description,
          }),
        ),
      )
    },
  },
  addCourse: {
    requiresReady: true,
    async handle(message, { host, actionContext }): Promise<Result<undefined, Error>> {
      const panel = shownAddCourse(host, message.sourcePanel.id)
      if (!panel) {
        return Err(NOT_SHOWN)
      }
      const listed = catalogOf(panel.id).courses.get(message.key)
      if (!listed) {
        return Err(new Error("That course is no longer listed here."))
      }
      if (actionContext.startup.userData.getCourse(listed.id).ok) {
        await vscode.commands.executeCommand("tmc.courseDetails", listed.id)
        return Ok(undefined)
      }
      // Silent: the card that asked shows the failure.
      const added = await withOperation(
        actionContext.dialog,
        { failure: "Failed to add course.", silent: true },
        () => actions.addNewCourse(actionContext, listed.organizationSlug, listed.id),
      )
      if (added.err) {
        return added
      }
      // Behind the course home, which opens next.
      await showNextWalkthroughStep(() => walkthroughProgressOf(actionContext)).catch((e) =>
        Logger.warn("Could not show the next walkthrough step", e),
      )
      await vscode.commands.executeCommand("tmc.courseDetails", listed.id)
      return Ok(undefined)
    },
  },
  addCourseAction: {
    requiresReady: true,
    async handle(message): Promise<void> {
      switch (message.action) {
        case "logIn": {
          const options: LoginOptions = { isAddingCourse: true }
          await vscode.commands.executeCommand("tmc.showMoocLogin", options)
          return
        }
        case "findCourse":
          await openWebLink(MOOC_BACKEND_URL)
          return
        default:
          assertUnreachable(message.action)
      }
    },
  },
} satisfies Partial<HandlerMap>

const NOT_SHOWN = new Error("The add-course screen is no longer shown.")

/** A listed course, as `addCourse` needs it. */
interface ListedCourse {
  id: CourseIdentifier
  /** The tmc organization it was listed under; empty for a mooc course. */
  organizationSlug: string
}

/** What a panel has listed: its courses by key, and its organizations' names by slug. */
interface Catalog {
  courses: Map<string, ListedCourse>
  organizations: Map<string, string>
}

/** By panel id; the newest panels only. */
const catalogs = new Map<number, Catalog>()

const CATALOGS_KEPT = 10

function catalogOf(panelId: number): Catalog {
  let catalog = catalogs.get(panelId)
  if (!catalog) {
    catalog = { courses: new Map(), organizations: new Map() }
    catalogs.set(panelId, catalog)
    for (const oldest of catalogs.keys()) {
      if (catalogs.size <= CATALOGS_KEPT) {
        break
      }
      catalogs.delete(oldest)
    }
  }
  return catalog
}

/** Lists `course` for `panel`, remembering it for `addCourse`. */
function catalogCourse(
  { startup }: ReadyActionContext,
  panel: AddCoursePanel,
  course: ListedCourse & {
    name: string
    organization: string
    description: string | null
    languageCode?: string
    isStaff?: boolean
  },
): CatalogCourse {
  const key = CourseIdentifier.key(course.id)
  catalogOf(panel.id).courses.set(key, { id: course.id, organizationSlug: course.organizationSlug })
  return {
    key,
    name: course.name,
    organization: course.organization,
    ...optionalDescription(course.description),
    ...(course.languageCode ? { languageCode: course.languageCode } : {}),
    ...(course.isStaff ? { isStaff: true } : {}),
    isAdded: startup.userData.getCourse(course.id).ok,
  }
}

function optionalDescription(text: string | null): { description?: string } {
  const description = text?.trim()
  return description ? { description } : {}
}

/** The add-course screen `host` shows, if it is still panel `id`. */
function shownAddCourse(host: PanelHost, id: number): AddCoursePanel | undefined {
  const route = host.route
  return route?.type === "AddCourse" && route.id === id ? route : undefined
}
