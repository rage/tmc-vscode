import { render, screen } from "@testing-library/svelte"

import type { Course, Organization } from "../shared/langsSchema"
import type { SelectCoursePanel } from "../shared/shared"
import { postedMessages } from "../test/setup"
import SelectCourse from "./SelectCourse.svelte"

const requestingPanel = { id: 7, type: "MyCourses" } as const
const panel: SelectCoursePanel = {
  id: 8,
  type: "SelectCourse",
  organizationSlug: "hy",
  requestingPanel,
}

const organization: Organization = {
  name: "University of Helsinki",
  slug: "hy",
  information: "info",
  logo_path: "/logos/small_logo/missing.png",
  pinned: false,
}

function course(overrides: Partial<Course>): Course {
  return {
    id: 55,
    name: "python-course",
    title: "Python Course",
    description: "learn python",
    comet_url: "",
    details_url: "",
    reviews_url: "",
    spyware_urls: [],
    unlock_url: "",
    ...overrides,
  }
}

function sendData(courses: Course[]) {
  const target = { type: "SelectCourse", id: panel.id }
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "setOrganization", target, organization } }),
  )
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "setTmcBackendUrl", target, tmcBackendUrl: "https://tmc.mooc.fi" },
    }),
  )
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "setSelectableCourses", target, courses } }),
  )
}

suite("SelectCourse panel", () => {
  test("requests its data on mount", () => {
    render(SelectCourse, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestSelectCourseData",
      sourcePanel: panel,
    })
  })

  test("renders the selectable courses", async () => {
    render(SelectCourse, { props: { panel } })
    sendData([course({ id: 55, title: "Python Course" })])
    expect(await screen.findByText("Python Course")).toBeInTheDocument()
  })

  test("replaces the loading UI with the error, leaving no spinner behind", async () => {
    const { container } = render(SelectCourse, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "requestSelectCourseDataError",
          target: { type: "SelectCourse", id: panel.id },
          error: "Failed to load courses",
        },
      }),
    )

    expect(await screen.findByText(/Error: Failed to load courses/)).toBeInTheDocument()
    // the organization progress-ring must not keep spinning under the error
    expect(container.querySelector("vscode-progress-ring")).toBeNull()
  })

  test("shows an empty state when the organization has no courses", async () => {
    render(SelectCourse, { props: { panel } })
    sendData([])
    expect(await screen.findByText(/No courses found for this organization/)).toBeInTheDocument()
  })

  test("relays the selected course id and organization slug", async () => {
    render(SelectCourse, { props: { panel } })
    sendData([course({ id: 55, title: "Python Course" })])
    const row = (await screen.findByText("Python Course")).closest(".course-row")
    postedMessages.mockClear()
    ;(row as HTMLElement).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "relayToWebview",
      message: {
        type: "selectedCourse",
        target: requestingPanel,
        organizationSlug: "hy",
        courseId: 55,
      },
    })
  })
})
