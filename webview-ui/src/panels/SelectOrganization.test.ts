import { render, screen } from "@testing-library/svelte"

import type { Organization } from "../shared/langsSchema"
import type { SelectOrganizationPanel } from "../shared/shared"
import { postedMessages } from "../test/setup"
import SelectOrganization from "./SelectOrganization.svelte"

const requestingPanel = { id: 7, type: "MyCourses" } as const
const panel: SelectOrganizationPanel = {
  id: 6,
  type: "SelectOrganization",
  requestingPanel,
}

function org(overrides: Partial<Organization>): Organization {
  return {
    name: "Org",
    slug: "org",
    information: "an organization",
    logo_path: "/logos/small_logo/missing.png",
    pinned: false,
    ...overrides,
  }
}

function sendOrgs(organizations: Organization[]) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "setOrganizations",
        target: { type: "SelectOrganization", id: panel.id },
        organizations,
      },
    }),
  )
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "setTmcBackendUrl",
        target: { type: "SelectOrganization", id: panel.id },
        tmcBackendUrl: "https://tmc.mooc.fi",
      },
    }),
  )
}

suite("SelectOrganization panel", () => {
  test("requests its data on mount", () => {
    render(SelectOrganization, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestSelectOrganizationData",
      sourcePanel: panel,
    })
  })

  test("renders the organizations once they arrive", async () => {
    render(SelectOrganization, { props: { panel } })
    sendOrgs([org({ name: "University of Helsinki", slug: "hy" })])
    expect(await screen.findByText("University of Helsinki")).toBeInTheDocument()
  })

  test("relays the selected organization slug", async () => {
    render(SelectOrganization, { props: { panel } })
    sendOrgs([
      org({ name: "Aalto", slug: "aalto", pinned: true }),
      org({ name: "University of Helsinki", slug: "hy" }),
    ])
    // "hy" is not pinned, so it appears exactly once (only in the all-orgs list)
    const row = (await screen.findByText("University of Helsinki")).closest(".org-row")
    postedMessages.mockClear()
    ;(row as HTMLElement).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "relayToWebview",
      message: { type: "selectedOrganization", target: requestingPanel, slug: "hy" },
    })
  })

  test("shows the error banner on requestSelectOrganizationDataError", async () => {
    render(SelectOrganization, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "requestSelectOrganizationDataError",
          target: { type: "SelectOrganization", id: panel.id },
          error: "no orgs",
        },
      }),
    )
    expect(await screen.findByText(/Error: no orgs/)).toBeInTheDocument()
  })
})
