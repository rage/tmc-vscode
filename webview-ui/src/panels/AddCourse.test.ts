import { fireEvent, render, screen, within } from "@testing-library/svelte"

import type {
  AddCoursePanel,
  CatalogCourse,
  MoocCatalog,
  TmcOrganizations,
} from "../../../shared/lib"
import { postedMessages, replyToRequest } from "../test/setup"
import AddCourse from "./AddCourse.svelte"

const PANEL: AddCoursePanel = { id: 31, type: "AddCourse", canAddMoocCourses: true }
const SOURCE = { id: PANEL.id, type: PANEL.type }

function course(name: string, overrides: Partial<CatalogCourse> = {}): CatalogCourse {
  return {
    key: `key:${name}`,
    name,
    organization: "University of Helsinki",
    isAdded: false,
    ...overrides,
  }
}

const MOOC_COURSES: MoocCatalog = {
  kind: "listed",
  items: [
    course("Introduction to everything", { description: "All of it, briefly." }),
    course("Python Programming", { isAdded: true }),
  ],
}

const ORGANIZATIONS: TmcOrganizations = {
  kind: "listed",
  items: [
    { slug: "mooc", name: "MOOC", description: "Courses for everyone." },
    { slug: "hy", name: "University of Helsinki" },
  ],
}

/** Renders the screen with the two backends' answers. */
async function renderScreen(
  mooc: MoocCatalog = MOOC_COURSES,
  organizations: TmcOrganizations = ORGANIZATIONS,
): Promise<void> {
  render(AddCourse, { props: { panel: PANEL } })
  replyToRequest("requestMoocCatalog", { ok: true, value: mooc })
  replyToRequest("requestTmcOrganizations", { ok: true, value: organizations })
  await screen.findByRole("heading", { level: 2, name: "tmc.mooc.fi" })
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name })
}

function cardNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "")
}

suite("the add-course screen", () => {
  test("asks both backends for their listings at once", () => {
    render(AddCourse, { props: { panel: PANEL } })

    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestMoocCatalog",
      requestId: expect.any(Number),
      sourcePanel: SOURCE,
    })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestTmcOrganizations",
      requestId: expect.any(Number),
      sourcePanel: SOURCE,
    })
    expect(screen.getByText("Loading your courses…")).toBeInTheDocument()
    expect(screen.getByText("Loading the organizations…")).toBeInTheDocument()
  })

  test("shows each course as a card with its organization and description", async () => {
    await renderScreen()

    const list = within(section("courses.mooc.fi")).getByRole("list", {
      name: "courses.mooc.fi courses",
    })
    expect(cardNames(list)).toEqual(["Introduction to everything", "Python Programming"])
    const card = within(list).getAllByRole("listitem")[0] as HTMLElement
    expect(within(card).getByText("University of Helsinki")).toBeInTheDocument()
    expect(within(card).getByText("All of it, briefly.")).toBeInTheDocument()
  })

  test("adds a course, and shows it adding meanwhile", async () => {
    await renderScreen()

    await fireEvent.click(screen.getByRole("button", { name: "Add Introduction to everything" }))

    expect(postedMessages).toHaveBeenCalledWith({
      type: "addCourse",
      requestId: expect.any(Number),
      sourcePanel: SOURCE,
      key: "key:Introduction to everything",
    })
    expect(screen.getByText("Adding…")).toBeInTheDocument()
  })

  test("marks an added course and opens it instead", async () => {
    await renderScreen()

    const card = screen.getByRole("heading", { name: "Python Programming" }).closest("li")
    expect(within(card as HTMLElement).getByText("Added")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add Python Programming" })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "Open Python Programming" }))

    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "addCourse", key: "key:Python Programming" }),
    )
  })

  test("a failed add shows why on its card, and can be tried again", async () => {
    await renderScreen()
    await fireEvent.click(screen.getByRole("button", { name: "Add Introduction to everything" }))

    replyToRequest("addCourse", { ok: false, error: { message: "Could not reach the server." } })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Could not add Introduction to everything")
    expect(alert).toHaveTextContent("Could not reach the server.")
    expect(
      screen.getByRole("button", { name: "Add Introduction to everything" }),
    ).toBeInTheDocument()
  })

  test("filters both backends' lists by every word searched", async () => {
    await renderScreen()

    await fireEvent.input(
      screen.getByRole("searchbox", { name: "Search courses and organizations" }),
      {
        target: { value: "briefly intro" },
      },
    )

    expect(cardNames(within(section("courses.mooc.fi")).getByRole("list"))).toEqual([
      "Introduction to everything",
    ])
    expect(
      within(section("tmc.mooc.fi")).getByText("Nothing here matches “briefly intro”."),
    ).toBeInTheDocument()
  })

  test("logged out of courses.mooc.fi, offers to log in", async () => {
    await renderScreen({ kind: "loggedOut" })

    const mooc = section("courses.mooc.fi")
    expect(within(mooc).getByText("Not logged in")).toBeInTheDocument()
    await fireEvent.click(within(mooc).getByRole("button", { name: "Log In" }))

    expect(postedMessages).toHaveBeenCalledWith({
      type: "addCourseAction",
      sourcePanel: SOURCE,
      action: "logIn",
    })
  })

  test("enrolled on no course, points to courses.mooc.fi", async () => {
    await renderScreen({ kind: "listed", items: [] })

    const mooc = section("courses.mooc.fi")
    expect(
      within(mooc).getByText(
        "You are not enrolled on any courses.mooc.fi course with programming exercises yet.",
      ),
    ).toBeInTheDocument()
    await fireEvent.click(
      within(mooc).getByRole("button", { name: "Find a Course on courses.mooc.fi" }),
    )

    expect(postedMessages).toHaveBeenCalledWith({
      type: "addCourseAction",
      sourcePanel: SOURCE,
      action: "findCourse",
    })
  })

  test("a tmc.mooc.fi list that fails is unavailable, blaming nothing, with Try Again", async () => {
    render(AddCourse, { props: { panel: PANEL } })
    replyToRequest("requestMoocCatalog", { ok: true, value: MOOC_COURSES })
    replyToRequest("requestTmcOrganizations", {
      ok: false,
      error: {
        message: "Could not reach the server. Check your network connection.",
        detailsId: "tmc-listing",
      },
    })

    const tmc = section("tmc.mooc.fi")
    const notice = await within(tmc).findByRole("status")
    expect(notice).toHaveTextContent("The tmc.mooc.fi course list is unavailable")
    expect(notice).not.toHaveTextContent(/network/)
    expect(within(tmc).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(notice).getByRole("button", { name: "Show Details" })).toBeInTheDocument()
    expect(cardNames(within(section("courses.mooc.fi")).getByRole("list"))).toHaveLength(2)
    postedMessages.mockClear()
    await fireEvent.click(within(tmc).getByRole("button", { name: "Try Again" }))
    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestTmcOrganizations" }),
    )
  })

  test("lists an organization's courses, and goes back to the organizations", async () => {
    await renderScreen()
    const tmc = section("tmc.mooc.fi")
    expect(cardNames(within(tmc).getByRole("list", { name: "tmc.mooc.fi organizations" }))).toEqual(
      ["MOOC", "University of Helsinki"],
    )

    await fireEvent.click(within(tmc).getByRole("button", { name: "Show the courses of MOOC" }))
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestTmcCourses",
      requestId: expect.any(Number),
      sourcePanel: SOURCE,
      organizationSlug: "mooc",
    })
    replyToRequest("requestTmcCourses", {
      ok: true,
      value: [course("Java Programming", { organization: "MOOC" })],
    })
    const courses = await within(tmc).findByRole("list", { name: "Courses of MOOC" })
    expect(cardNames(courses)).toEqual(["Java Programming"])
    expect(within(tmc).getByRole("heading", { level: 3, name: "MOOC" })).toHaveFocus()

    await fireEvent.click(
      document.querySelector('vscode-toolbar-button[title="Back to Organizations"]') as Element,
    )
    expect(within(tmc).getByRole("list", { name: "tmc.mooc.fi organizations" })).toBeInTheDocument()
  })

  test("an organization with no courses says so", async () => {
    await renderScreen()
    await fireEvent.click(screen.getByRole("button", { name: "Show the courses of MOOC" }))
    replyToRequest("requestTmcCourses", { ok: true, value: [] })

    expect(await screen.findByText("This organization has no courses.")).toBeInTheDocument()
  })

  test("Find a Course is in the overflow menu", async () => {
    await renderScreen()

    await fireEvent.click(screen.getByRole("button", { name: "More Actions" }))
    await fireEvent.click(
      await screen.findByRole("menuitem", { name: "Find a Course on courses.mooc.fi" }),
    )

    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "addCourseAction", action: "findCourse" }),
    )
  })

  test("without courses.mooc.fi, lists only tmc.mooc.fi and offers no way to find a course", async () => {
    render(AddCourse, { props: { panel: { ...PANEL, canAddMoocCourses: false } } })
    replyToRequest("requestTmcOrganizations", { ok: true, value: ORGANIZATIONS })
    await screen.findByRole("heading", { level: 2, name: "tmc.mooc.fi" })

    expect(postedMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestMoocCatalog" }),
    )
    expect(screen.queryByRole("region", { name: "courses.mooc.fi" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "More Actions" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show the courses of MOOC" })).toBeInTheDocument()
  })
})
