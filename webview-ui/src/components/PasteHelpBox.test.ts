import { render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { postedMessages, replyToRequest } from "../test/setup"
import PasteHelpBox from "./PasteHelpBox.svelte"

const sourcePanel = { id: 1, type: "ExerciseSubmission" } as const
const oncopy = vi.fn()
const tmcProps = { backend: "tmc", sourcePanel, oncopy } as const
const moocProps = { ...tmcProps, backend: "mooc" } as const

/** Opens the help and starts a paste. */
async function paste(): Promise<HTMLElement> {
  ;(await screen.findByRole("button", { name: "Need help?" })).click()
  const submit = await screen.findByRole("button", { name: "Submit to TMC Server paste" })
  submit.click()
  return submit
}

suite("PasteHelpBox component", () => {
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

    const link = await screen.findByRole("link", { name: "https://paste.example/abc" })
    expect(link).toBeVisible()
  })

  test("says why a paste failed", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()

    replyToRequest("pasteExercise", { ok: false, error: { message: "paste service is down" } })

    expect(await screen.findByText(/paste service is down/)).toBeInTheDocument()
  })

  test("names the backend the code is sent to", async () => {
    render(PasteHelpBox, { props: moocProps })

    ;(await screen.findByRole("button", { name: "Need help?" })).click()
    expect(
      await screen.findByRole("button", { name: "Submit to courses.mooc.fi paste" }),
    ).toBeInTheDocument()
  })

  test("the toggle says whether the help is open", async () => {
    render(PasteHelpBox, { props: tmcProps })

    const toggle = await screen.findByRole("button", { name: "Need help?" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    toggle.click()
    await vi.waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
  })

  test("a paste in flight cannot be started again", async () => {
    render(PasteHelpBox, { props: tmcProps })

    const submit = await paste()
    await vi.waitFor(() => expect(submit).toHaveAttribute("disabled"))
    expect(screen.getByText("Sending to TMC Server paste…")).toBeInTheDocument()

    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })
    await vi.waitFor(() => expect(submit).not.toHaveAttribute("disabled"))
  })

  test("hands the paste link to the panel's copy action", async () => {
    render(PasteHelpBox, { props: tmcProps })
    await paste()
    replyToRequest("pasteExercise", { ok: true, value: "https://paste.example/abc" })

    ;(await screen.findByRole("button", { name: "Copy link" })).click()
    expect(oncopy).toHaveBeenCalledWith("https://paste.example/abc")
  })

  test("warns that a courses.mooc.fi paste is also a graded submission", async () => {
    render(PasteHelpBox, { props: moocProps })
    ;(await screen.findByRole("button", { name: "Need help?" })).click()

    expect(await screen.findByText(/also submits your answer for grading/)).toBeInTheDocument()
  })
})
