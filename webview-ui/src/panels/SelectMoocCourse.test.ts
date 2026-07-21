import { fireEvent, render, screen, waitFor } from "@testing-library/svelte"

import type { MoocCourse } from "../shared/langsSchema"
import type { SelectMoocCoursePanel } from "../shared/shared"
import { MOOC_COURSE_ID, MOOC_INSTANCE_ID } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import SelectMoocCourse from "./SelectMoocCourse.svelte"

const requestingPanel = { id: 7, type: "MyCourses" } as const
const panel: SelectMoocCoursePanel = {
  id: 3,
  type: "SelectMoocCourse",
  requestingPanel,
}

const pythonCourse: MoocCourse = {
  id: MOOC_INSTANCE_ID,
  name: "MOOC Python Programming",
  slug: "mooc-python",
  organization_name: "mooc.fi",
  description: "Learn Python.",
}
const javaCourse: MoocCourse = {
  id: MOOC_COURSE_ID,
  name: "Java Programming",
  slug: "mooc-java",
  organization_name: "mooc.fi",
  description: null,
}

/** Dispatch a schema-valid `setSelectMoocCourseData` broadcast at the webview. */
function sendCourses(courseInstances: MoocCourse[]) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "setSelectMoocCourseData",
        target: { type: "SelectMoocCourse" },
        courseInstances,
      },
    }),
  )
}

suite("SelectMoocCourse panel", () => {
  test("requests its course data from the extension host on mount", () => {
    render(SelectMoocCourse, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestSelectMoocCourseData",
      sourcePanel: panel,
    })
  })

  test("renders the enrolled courses once the data arrives", async () => {
    render(SelectMoocCourse, { props: { panel } })
    sendCourses([pythonCourse, javaCourse])

    expect(await screen.findByText("MOOC Python Programming")).toBeInTheDocument()
    expect(screen.getByText("Java Programming")).toBeInTheDocument()
    expect(screen.getByText("(mooc-python)")).toBeInTheDocument()
    expect(screen.getByText("Learn Python.")).toBeInTheDocument()
  })

  test("shows the empty-state message when the course list is empty", async () => {
    render(SelectMoocCourse, { props: { panel } })
    sendCourses([])

    expect(await screen.findByText(/No enrolled courses found/)).toBeInTheDocument()
  })

  test("always shows the enrolled-only explainer, with and without courses", async () => {
    render(SelectMoocCourse, { props: { panel } })

    // present once courses have loaded
    sendCourses([pythonCourse])
    expect(await screen.findByText("MOOC Python Programming")).toBeInTheDocument()
    expect(
      screen.getByText(/These are the courses you're enrolled in on courses\.mooc\.fi/),
    ).toBeInTheDocument()

    // and still present when the list is empty
    sendCourses([])
    await screen.findByText(/No enrolled courses found/)
    expect(
      screen.getByText(/These are the courses you're enrolled in on courses\.mooc\.fi/),
    ).toBeInTheDocument()
  })

  test("shows the error banner when a requestSelectMoocCourseDataError message arrives", async () => {
    render(SelectMoocCourse, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "requestSelectMoocCourseDataError",
          target: { type: "SelectMoocCourse", id: panel.id },
          error: "Failed to load courses",
        },
      }),
    )

    expect(await screen.findByText(/Error: Failed to load courses/)).toBeInTheDocument()
  })

  test("filters the list by name and slug", async () => {
    const { container } = render(SelectMoocCourse, { props: { panel } })
    sendCourses([pythonCourse, javaCourse])
    await screen.findByText("MOOC Python Programming")

    const search = container.querySelector<HTMLInputElement>("vscode-textfield")
    expect(search).not.toBeNull()
    if (search) {
      search.value = "java"
      await fireEvent.input(search)
    }

    await waitFor(() => {
      // the matching row stays visible, the non-matching one is hidden
      expect(screen.getByText("Java Programming").closest(".course-row")).toBeVisible()
      expect(screen.getByText("MOOC Python Programming").closest(".course-row")).not.toBeVisible()
    })
  })

  test("posts the selected course through the relay with the exact payload", async () => {
    render(SelectMoocCourse, { props: { panel } })
    sendCourses([pythonCourse])
    const row = (await screen.findByText("MOOC Python Programming")).closest(".course-row")
    expect(row).not.toBeNull()
    postedMessages.mockClear()

    ;(row as HTMLElement).click()

    // the course id doubles as the instance id (langs has no course-instance concept)
    expect(postedMessages).toHaveBeenCalledWith({
      type: "relayToWebview",
      message: {
        type: "selectedMoocCourse",
        target: requestingPanel,
        instanceId: MOOC_INSTANCE_ID,
        courseName: "MOOC Python Programming",
      },
    })
  })
})
