import { render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { postedMessages, replyToRequest } from "../test/setup"
import PasteHelpBox from "./PasteHelpBox.svelte"

const sourcePanel = { id: 1, type: "ExerciseSubmission" } as const
const oncopy = vi.fn()
const props = { sourcePanel, oncopy } as const

async function paste(): Promise<HTMLElement> {
  const send = await screen.findByRole("button", { name: "Send to Pastebin" })
  send.click()
  return send
}

suite("PasteHelpBox component", () => {
  test("asks the host to paste the exercise the panel shows", async () => {
    render(PasteHelpBox, { props })

    await paste()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "pasteExercise",
      requestId: expect.any(Number),
      sourcePanel,
    })
  })

  test("shows the paste link the host answers with", async () => {
    render(PasteHelpBox, { props })
    await paste()

    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://paste.example/abc", isReused: false },
    })

    expect(await screen.findByText("https://paste.example/abc")).toBeVisible()
  })

  test("has the host open the paste link, which it checks first", async () => {
    render(PasteHelpBox, { props })
    await paste()
    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://paste.example/abc", isReused: false },
    })

    ;(await screen.findByRole("button", { name: "Open Link" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://paste.example/abc",
    })
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  test("says why a paste failed", async () => {
    render(PasteHelpBox, { props })
    await paste()

    replyToRequest("pasteExercise", { ok: false, error: { message: "paste service is down" } })

    expect(await screen.findByText(/paste service is down/)).toBeInTheDocument()
  })

  test("names the pastebin, not the backend's host", async () => {
    render(PasteHelpBox, { props })
    expect(await screen.findByText(/Send your code to/)).not.toHaveTextContent(/mooc\.fi/)
  })

  test("a paste in flight cannot be started again", async () => {
    render(PasteHelpBox, { props })

    const send = await paste()
    await vi.waitFor(() => expect(send).toHaveAttribute("disabled"))
    expect(screen.getByText("Sending to the pastebin…")).toBeInTheDocument()

    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://paste.example/abc", isReused: false },
    })
    expect(await screen.findByRole("button", { name: "Send Again" })).not.toHaveAttribute(
      "disabled",
    )
  })

  test("hands the paste link to the panel's copy action", async () => {
    render(PasteHelpBox, { props })
    await paste()
    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://paste.example/abc", isReused: false },
    })

    ;(await screen.findByRole("button", { name: "Copy Link" })).click()
    expect(oncopy).toHaveBeenCalledWith("https://paste.example/abc")
  })

  test("does not call a paste a submission", async () => {
    render(PasteHelpBox, { props })
    expect(await screen.findByText(/Send your code to/)).not.toHaveTextContent(/submit|grad/i)
  })

  test("says when the link is the last one, as the code is unchanged since", async () => {
    render(PasteHelpBox, { props })
    await paste()

    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://paste.example/abc", isReused: true },
    })

    expect(await screen.findByText(/unchanged since you last sent it/)).toBeVisible()
    expect(screen.getByText("https://paste.example/abc")).toBeVisible()
  })

  test("pastes when its owner asks, as a command that opens Get help does", async () => {
    const { component } = render(PasteHelpBox, { props })

    void component.paste()
    void component.paste()

    await vi.waitFor(() =>
      expect(
        postedMessages.mock.calls.filter(([message]) => message.type === "pasteExercise"),
      ).toHaveLength(1),
    )
  })
})
