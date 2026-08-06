import { render, screen } from "@testing-library/svelte"

import { findButton, getButton } from "../test/dom"
import { tmcLocalCourse, tmcLocalExercise } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import PasteHelpBox from "./PasteHelpBox.svelte"

const sourcePanel = { id: 1, type: "ExerciseTests" } as const
const course = tmcLocalCourse()
const exercise = tmcLocalExercise()

suite("PasteHelpBox component", () => {
  test("posts a pasteExercise message with the course, exercise and requesting panel", async () => {
    render(PasteHelpBox, { props: { hidden: false, course, exercise, sourcePanel } })

    // reveal the help section, then trigger the paste
    getButton("Need help?").click()
    const submit = await findButton("Submit to TMC Paste")
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
        hidden: false,
        course,
        exercise,
        sourcePanel,
        pasteUrl: "https://paste.example/abc",
      },
    })

    getButton("Need help?").click()
    const link = await screen.findByRole("link", { name: "https://paste.example/abc" })
    expect(link).toBeVisible()
  })
})
