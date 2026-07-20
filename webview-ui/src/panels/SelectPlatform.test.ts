import { render, screen } from "@testing-library/svelte"

import type { SelectPlatformPanel } from "../shared/shared"
import { postedMessages } from "../test/setup"
import SelectPlatform from "./SelectPlatform.svelte"

const requestingPanel = { id: 7, type: "MyCourses" } as const
const panel: SelectPlatformPanel = {
  id: 5,
  type: "SelectPlatform",
  requestingPanel,
}

suite("SelectPlatform panel", () => {
  test("renders both platform choices", () => {
    render(SelectPlatform, { props: { panel } })
    expect(screen.getByText("https://courses.mooc.fi")).toBeInTheDocument()
    expect(screen.getByText("https://tmc.mooc.fi")).toBeInTheDocument()
  })

  test("selecting the mooc platform posts selectMoocCourse targeting the requesting panel", () => {
    render(SelectPlatform, { props: { panel } })
    postedMessages.mockClear()

    screen.getByText("https://courses.mooc.fi").closest<HTMLElement>('[role="button"]')?.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "selectMoocCourse",
      sourcePanel: requestingPanel,
    })
  })

  test("selecting the tmc platform posts selectOrganization targeting the requesting panel", () => {
    render(SelectPlatform, { props: { panel } })
    postedMessages.mockClear()

    screen.getByText("https://tmc.mooc.fi").closest<HTMLElement>('[role="button"]')?.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "selectOrganization",
      sourcePanel: requestingPanel,
    })
  })
})
