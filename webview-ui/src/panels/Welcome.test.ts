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

  // Without the version the heading still has to read as a finished sentence.
  test("renders the heading without a gap when the version is unknown", () => {
    render(Welcome, { props: { panel: { id: 2, type: "Welcome" } } })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome to TestMyCode!")
  })

  test("offers My Courses once logged in", async () => {
    render(Welcome, { props: { panel: { ...panel, loggedIn: true } } })
    postedMessages.mockClear()

    ;(await screen.findByRole("button", { name: "My Courses" })).click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "openMyCourses" })
    expect(screen.queryByText(/To get started/)).not.toBeInTheDocument()
  })

  test("tells a logged-out student where to log in", async () => {
    render(Welcome, { props: { panel: { ...panel, loggedIn: false } } })

    expect(screen.getByText(/To get started/)).toHaveTextContent("TestMyCode: Log In")
    await screen.findByRole("button", { name: "Read instructions" })
    expect(screen.queryByRole("button", { name: "My Courses" })).not.toBeInTheDocument()
  })

  // One login covers both backends, so the page must not ask the student to pick an account.
  test("names courses.mooc.fi as the one account to log in with", () => {
    render(Welcome, { props: { panel } })
    expect(screen.getByText(/Log in with your/)).toHaveTextContent(
      "Log in with your courses.mooc.fi account. The same account works for courses on both",
    )
    expect(screen.queryByText(/one of the two supported platforms/)).not.toBeInTheDocument()
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
