import { render, screen } from "@testing-library/svelte"
import { tick } from "svelte"

import { releaseNotes } from "../generated/releaseNotes"
import type { WelcomePanel } from "../shared/shared"
import { pasteServiceName } from "../shared/shared"
import { dispatchToWebview, postedMessages } from "../test/setup"
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
      requestId: expect.any(Number),
      sourcePanel: panel,
    })
  })

  // Nothing on the page depends on the answer, so the one place a failure can be seen
  // is the log; the host raises the user-facing notification itself.
  test("logs a request the extension host could not serve", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    render(Welcome, { props: { panel: { id: 2, type: "Welcome" } } })
    const request = postedMessages.mock.calls[0]?.[0] as { requestId: number }

    dispatchToWebview({
      type: "panelDataResult",
      target: { id: 2, type: "Welcome" },
      requestId: request.requestId,
      error: { message: "The extension did not initialize properly" },
    })
    await tick()

    expect(warn).toHaveBeenCalledWith(
      "Could not read the extension version:",
      "The extension did not initialize properly",
    )
    warn.mockRestore()
  })

  // The version arrives in a message, so until it does -- or if it never does -- the
  // heading has to read as a finished sentence rather than one with a hole in it.
  test("renders the heading without a gap before the version arrives", () => {
    render(Welcome, { props: { panel: { id: 2, type: "Welcome" } } })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome to TestMyCode!")
  })

  test("updates the version when setWelcomeData arrives", async () => {
    render(Welcome, { props: { panel: { id: 2, type: "Welcome" } } })
    dispatchToWebview({
      type: "setWelcomeData",
      target: { type: "Welcome", id: 2 },
      version: "9.9.9",
    })
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
