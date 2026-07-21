import { render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { makeTmcKind } from "../shared/shared"
import { getButton } from "../test/dom"
import { tmcExerciseGroup } from "../test/fixtures"
import ExercisePart from "./ExercisePart.svelte"

const noop = () => {}

suite("ExercisePart component", () => {
  test("renders the group name and completion counts", () => {
    const { container } = render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: { tmc: {}, mooc: {} },
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    // The heading lives in shadow DOM, which doesn't upgrade under jsdom, so assert the attribute.
    expect(container.querySelector("vscode-collapsible")?.getAttribute("heading")).toBe("part01")
    expect(screen.getByText("Completed: 1 / 1")).toBeInTheDocument()
  })

  test("resolves each exercise's status via the identifier match", () => {
    render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: { tmc: {}, mooc: {} },
        exerciseStatuses: { tmc: { 101: "opened" }, mooc: {} },
      },
    })

    // The raw "opened" enum is rendered as a friendly label.
    expect(screen.getByText("Opened")).toBeInTheDocument()
  })

  test("Download all passes every exercise identifier back to the callback", () => {
    const onDownloadAll = vi.fn()
    render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: { tmc: {}, mooc: {} },
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    getButton("Download all").click()

    expect(onDownloadAll).toHaveBeenCalledWith([makeTmcKind({ tmcExerciseId: 101 })])
  })
})
