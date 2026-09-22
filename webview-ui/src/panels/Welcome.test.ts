import { render, screen } from "@testing-library/svelte"

import { releaseNotes } from "../generated/releaseNotes"
import type { WelcomePanel } from "../shared/shared"
import { pasteServiceName } from "../shared/shared"
import { postedMessages } from "../test/setup"
import Welcome from "./Welcome.svelte"

const panel: WelcomePanel = { id: 2, type: "Welcome", version: "3.5.3" }

suite("Welcome panel", () => {
  test("renders the welcome heading with the version", () => {
    render(Welcome, { props: { panel } })
    expect(screen.getByRole("heading", { name: /Welcome to TestMyCode 3.5.3/ })).toBeInTheDocument()
  })

  test("requests its welcome data on mount", () => {
    render(Welcome, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestWelcomeData",
      sourcePanel: panel,
    })
  })

  test("updates the version when setWelcomeData arrives", async () => {
    render(Welcome, { props: { panel: { id: 2, type: "Welcome" } } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "setWelcomeData", target: { type: "Welcome", id: 2 }, version: "9.9.9" },
      }),
    )
    expect(
      await screen.findByRole("heading", { name: /Welcome to TestMyCode 9.9.9/ }),
    ).toBeInTheDocument()
  })

  // The notice covers both backends, so it names each paste service through the shared
  // contract instead of spelling one of them out.
  test("names both paste services in the data collection notice", () => {
    render(Welcome, { props: { panel } })
    const notice = screen.getByText(/The same applies if you choose to submit your answer/)
    expect(notice).toHaveTextContent(`${pasteServiceName("tmc")} or ${pasteServiceName("mooc")}`)
  })

  // What matters is that the panel shows whatever CHANGELOG.md currently says,
  // not a fixed list this test would have to be kept in step with.
  test("renders every generated release note", () => {
    render(Welcome, { props: { panel } })
    expect(releaseNotes.length).toBeGreaterThan(0)
    for (const note of releaseNotes) {
      const heading = note.date ? `${note.version} - ${note.date}` : note.version
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeInTheDocument()
    }
  })

  test("renders the entries of the newest release note", () => {
    render(Welcome, { props: { panel } })
    const newest = releaseNotes[0]
    expect(newest?.entries.length).toBeGreaterThan(0)
    for (const entry of newest?.entries ?? []) {
      expect(screen.getByText(entry)).toBeInTheDocument()
    }
  })
})
