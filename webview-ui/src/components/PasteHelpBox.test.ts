import { fireEvent, render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { postedMessages, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import PasteHelpBox from "./PasteHelpBox.svelte"

const sourcePanel = { id: 1, type: "ExerciseSubmission" } as const
const oncopy = vi.fn()
const onhide = vi.fn()
const tmcProps = { backend: "tmc", sourcePanel, oncopy, onhide } as const
const moocProps = { ...tmcProps, backend: "mooc" } as const

async function paste(): Promise<HTMLElement> {
  const send = await screen.findByRole("button", { name: "Send to tmc.mooc.fi paste" })
  send.click()
  return send
}

suite("PasteHelpBox component", () => {
  test("is a Get help section", () => {
    render(PasteHelpBox, { props: tmcProps })
    expect(screen.getByRole("region", { name: "Get help" })).toBeInTheDocument()
  })

  test("asks the host to paste the exercise the panel shows", async () => {
    render(PasteHelpBox, { props: tmcProps })

    await paste()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "pasteExercise",
      requestId: expect.any(Number),
      sourcePanel,
    })
  })

  test("shows the paste link the host answers with", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()

    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })

    expect(await screen.findByText("https://paste.example/abc")).toBeVisible()
  })

  test("has the host open the paste link, which it checks first", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()
    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })

    ;(await screen.findByRole("button", { name: "Open Link" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://paste.example/abc",
    })
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  test("says why a paste failed", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()

    replyToRequest("pasteExercise", { ok: false, error: { message: "paste service is down" } })

    expect(await screen.findByText(/paste service is down/)).toBeInTheDocument()
  })

  test("names the backend the code is sent to", async () => {
    render(PasteHelpBox, { props: moocProps })
    expect(
      await screen.findByRole("button", { name: "Send to courses.mooc.fi paste" }),
    ).toBeInTheDocument()
  })

  test("a paste in flight cannot be started again", async () => {
    render(PasteHelpBox, { props: tmcProps })

    const send = await paste()
    await vi.waitFor(() => expect(send).toHaveAttribute("disabled"))
    expect(screen.getByText("Sending to tmc.mooc.fi paste…")).toBeInTheDocument()

    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })
    expect(await screen.findByRole("button", { name: "Send Again" })).not.toHaveAttribute(
      "disabled",
    )
  })

  test("hands the paste link to the panel's copy action", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()
    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })

    ;(await screen.findByRole("button", { name: "Copy Link" })).click()
    expect(oncopy).toHaveBeenCalledWith("https://paste.example/abc")
  })

  test("warns that a courses.mooc.fi paste is also a graded submission", async () => {
    render(PasteHelpBox, { props: moocProps })
    expect(await screen.findByText(/also submits your answer for grading/)).toBeInTheDocument()
  })

  test("can be hidden again", async () => {
    render(PasteHelpBox, { props: tmcProps })
    const hide = await withinShadowRoot(screen.getByTitle("Hide Get Help"))
    await fireEvent.click(hide.getByRole("button"))
    expect(onhide).toHaveBeenCalledOnce()
  })
})
