import { render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { makeTmcKind } from "../shared/shared"
import { tmcExerciseGroup } from "../test/fixtures"
import ExercisePart from "./ExercisePart.svelte"

const noop = () => {}

suite("ExercisePart component", () => {
  test("renders the group name and completion counts", () => {
    render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: { tmc: {}, mooc: {} },
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    expect(screen.getByRole("heading", { name: "part01" })).toBeInTheDocument()
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

    expect(screen.getByText("opened")).toBeInTheDocument()
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

    screen.getByRole("button", { name: "Download all" }).click()

    expect(onDownloadAll).toHaveBeenCalledWith([makeTmcKind({ tmcExerciseId: 101 })])
  })
})
