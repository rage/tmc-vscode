import { render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { moocLocalCourse, tmcLocalCourse, tmcLocalExercise } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import PasteHelpBox from "./PasteHelpBox.svelte"

const sourcePanel = { id: 1, type: "ExerciseTests" } as const
const course = tmcLocalCourse()
const exercise = tmcLocalExercise()

suite("PasteHelpBox component", () => {
  test("posts a pasteExercise message with the course, exercise and requesting panel", async () => {
    render(PasteHelpBox, { props: { course, exercise, sourcePanel } })

    // reveal the help section, then trigger the paste
    ;(await screen.findByRole("button", { name: "Need help?" })).click()
    const submit = await screen.findByRole("button", { name: "Submit to TMC Server paste" })
    postedMessages.mockClear()
    submit.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "pasteExercise",
      course,
      exercise,
      requestingPanel: sourcePanel,
    })
  })

  test("shows the paste link once it is available and the help is open", async () => {
    render(PasteHelpBox, {
      props: {
        course,
        exercise,
        sourcePanel,
        pasteUrl: "https://paste.example/abc",
      },
    })

    ;(await screen.findByRole("button", { name: "Need help?" })).click()
    const link = await screen.findByRole("link", { name: "https://paste.example/abc" })
    expect(link).toBeVisible()
  })

  test("names the backend the code is sent to", async () => {
    render(PasteHelpBox, {
      props: { course: moocLocalCourse(), exercise, sourcePanel },
    })

    ;(await screen.findByRole("button", { name: "Need help?" })).click()
    expect(
      await screen.findByRole("button", { name: "Submit to courses.mooc.fi paste" }),
    ).toBeInTheDocument()
  })

  test("the toggle says whether the help is open", async () => {
    render(PasteHelpBox, { props: { course, exercise, sourcePanel } })

    const toggle = await screen.findByRole("button", { name: "Need help?" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    toggle.click()
    await vi.waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
  })

  test("a paste in flight cannot be started again", async () => {
    const { rerender } = render(PasteHelpBox, { props: { course, exercise, sourcePanel } })
    ;(await screen.findByRole("button", { name: "Need help?" })).click()
    const submit = await screen.findByRole("button", { name: "Submit to TMC Server paste" })

    submit.click()
    await vi.waitFor(() => expect(submit).toHaveAttribute("disabled"))
    expect(screen.getByText("Sending to TMC Server paste…")).toBeInTheDocument()

    await rerender({ course, exercise, sourcePanel, pasteUrl: "https://paste.example/abc" })
    await vi.waitFor(() => expect(submit).not.toHaveAttribute("disabled"))
  })

  test("copies the paste link through the host", async () => {
    render(PasteHelpBox, {
      props: { course, exercise, sourcePanel, pasteUrl: "https://paste.example/abc" },
    })
    ;(await screen.findByRole("button", { name: "Need help?" })).click()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Copy link" })).click()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "copyToClipboard",
      text: "https://paste.example/abc",
    })
  })

  test("warns that a courses.mooc.fi paste is also a graded submission", async () => {
    render(PasteHelpBox, { props: { course: moocLocalCourse(), exercise, sourcePanel } })
    ;(await screen.findByRole("button", { name: "Need help?" })).click()

    expect(await screen.findByText(/also submits your answer for grading/)).toBeInTheDocument()
  })
})
