import { fireEvent, render, screen } from "@testing-library/svelte"
import { SvelteMap } from "svelte/reactivity"
import { vi } from "vitest"

import type { ExerciseIdentifier } from "../shared/shared"
import { makeTmcKind } from "../shared/shared"
import { getButton } from "../test/dom"
import { tmcExerciseGroup } from "../test/fixtures"
import ExercisePart from "./ExercisePart.svelte"

const noop = () => {}
const emptySelection = () => new SvelteMap<string, ExerciseIdentifier>()

suite("ExercisePart component", () => {
  test("renders the group name and completion counts", () => {
    const { container } = render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: emptySelection(),
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
        checkedExercises: emptySelection(),
        exerciseStatuses: { tmc: { 101: "opened" }, mooc: {} },
      },
    })

    // The raw "opened" enum is rendered as a friendly label.
    expect(screen.getByText("Opened")).toBeInTheDocument()
  })

  test("states the soft-deadline policy once, with only the date in each row", () => {
    const group = tmcExerciseGroup({
      exercises: [
        {
          id: makeTmcKind({ tmcExerciseId: 101 }),
          name: "part01-01_hello",
          isHard: false,
          hardDeadlineString: "2026-01-31",
          softDeadlineString: "2026-01-01",
          passed: true,
        },
        {
          id: makeTmcKind({ tmcExerciseId: 102 }),
          name: "part01-02_bye",
          isHard: false,
          hardDeadlineString: "2026-02-28",
          softDeadlineString: "2026-02-01",
          passed: false,
        },
      ],
    })
    render(ExercisePart, {
      props: {
        exerciseGroup: group,
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: emptySelection(),
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    expect(screen.getAllByText(/award only 75% of the exercise points/)).toHaveLength(1)
    expect(screen.getByText(/Hard deadline: 2026-01-31/)).toBeInTheDocument()
    expect(screen.getByText(/Hard deadline: 2026-02-28/)).toBeInTheDocument()
  })

  test("Download all passes every exercise identifier back to the callback", () => {
    const onDownloadAll = vi.fn()
    render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises: emptySelection(),
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    getButton("Download all").click()

    expect(onDownloadAll).toHaveBeenCalledWith([makeTmcKind({ tmcExerciseId: 101 })])
  })

  // Unchecking has to remove the entry, not record `false`: the panel counts entries.
  test("adds a checked exercise to the selection and drops it again when unchecked", async () => {
    const checkedExercises = emptySelection()
    const { container } = render(ExercisePart, {
      props: {
        exerciseGroup: tmcExerciseGroup(),
        onDownloadAll: noop,
        onOpenAll: noop,
        onCloseAll: noop,
        checkedExercises,
        exerciseStatuses: { tmc: {}, mooc: {} },
      },
    })

    // vscode-checkbox is inert under jsdom, so set `.checked` and dispatch `change` directly.
    const selectAll = container.querySelector<HTMLElement & { checked: boolean }>("vscode-checkbox")
    expect(selectAll).not.toBeNull()

    selectAll!.checked = true
    await fireEvent.change(selectAll!)
    expect([...checkedExercises.values()]).toEqual([makeTmcKind({ tmcExerciseId: 101 })])

    selectAll!.checked = false
    await fireEvent.change(selectAll!)
    expect(checkedExercises.size).toBe(0)
  })
})
