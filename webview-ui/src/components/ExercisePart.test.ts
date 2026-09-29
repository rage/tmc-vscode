import { fireEvent, render, screen } from "@testing-library/svelte"
import { SvelteMap } from "svelte/reactivity"
import { vi } from "vitest"

import type { ExerciseGroup, ExerciseStatus } from "../shared/shared"
import { ExerciseIdentifier, makeTmcKind } from "../shared/shared"
import { tmcExerciseGroup } from "../test/fixtures"
import { withinShadowRoot } from "../test/shadow"
import ExercisePart from "./ExercisePart.svelte"

const noop = () => {}
const emptySelection = () => new SvelteMap<string, ExerciseIdentifier>()

const twoExerciseGroup = (): ExerciseGroup =>
  tmcExerciseGroup({
    exercises: [
      {
        id: makeTmcKind({ tmcExerciseId: 101 }),
        name: "01_hello",
        isHard: false,
        hardDeadlineString: "Jan 31, 2026, 12:00 PM",
        softDeadlineString: "Jan 1, 2026, 12:00 PM",
        deadlineIso: "2026-01-01T12:00:00.000Z",
        passed: true,
      },
      {
        id: makeTmcKind({ tmcExerciseId: 102 }),
        name: "02_bye",
        isHard: true,
        hardDeadlineString: "Feb 28, 2026, 12:00 PM",
        softDeadlineString: "-",
        deadlineIso: "2026-02-28T12:00:00.000Z",
        passed: false,
      },
    ],
  })

function renderPart(
  overrides: {
    exerciseGroup?: ExerciseGroup
    statuses?: Record<number, ExerciseStatus>
    checkedExercises?: SvelteMap<string, ExerciseIdentifier>
    onDownloadAll?: (ids: ExerciseIdentifier[]) => void
    onOpenAll?: (ids: ExerciseIdentifier[]) => void
    onCloseAll?: (ids: ExerciseIdentifier[]) => void
  } = {},
) {
  return render(ExercisePart, {
    props: {
      exerciseGroup: overrides.exerciseGroup ?? tmcExerciseGroup(),
      onDownloadAll: overrides.onDownloadAll ?? noop,
      onOpenAll: overrides.onOpenAll ?? noop,
      onCloseAll: overrides.onCloseAll ?? noop,
      checkedExercises: overrides.checkedExercises ?? emptySelection(),
      exerciseStatuses: { tmc: overrides.statuses ?? {}, mooc: {} },
    },
  })
}

suite("ExercisePart component", () => {
  test("is a named heading toggle that states the part's completion", () => {
    renderPart()

    expect(screen.getByRole("heading", { level: 2, name: /part01/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "part01 1 / 1 completed" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("starts collapsed when the view model says so", () => {
    renderPart({ exerciseGroup: tmcExerciseGroup({ defaultOpen: false }) })

    expect(screen.getByRole("button", { name: /^part01/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })

  test("says each exercise's local state and completion in words", () => {
    renderPart({ exerciseGroup: twoExerciseGroup(), statuses: { 101: "opened", 102: "missing" } })

    expect(screen.getByText("Opened")).toBeInTheDocument()
    expect(screen.getByText("Not downloaded")).toBeInTheDocument()
    expect(screen.getByText("Passed")).toBeInTheDocument()
    expect(screen.getByText("Not passed")).toBeInTheDocument()
  })

  test("shows the deadline in effect as a machine-readable time, with the hard one beside it", () => {
    renderPart({ exerciseGroup: twoExerciseGroup() })

    const soft = screen.getByText("Jan 1, 2026, 12:00 PM")
    expect(soft.tagName).toBe("TIME")
    expect(soft).toHaveAttribute("datetime", "2026-01-01T12:00:00.000Z")
    expect(screen.getByText("hard: Jan 31, 2026, 12:00 PM")).toBeInTheDocument()
    expect(screen.queryByText("hard: Feb 28, 2026, 12:00 PM")).not.toBeInTheDocument()
  })

  test("sizes its columns instead of splitting the width evenly", async () => {
    const { container } = renderPart()

    expect(container.querySelector("vscode-table")?.columns).toEqual([
      "32px",
      "auto",
      "200px",
      "160px",
    ])
    const header = container.querySelector("vscode-table-header")!
    await header.updateComplete
    expect(header).toHaveAttribute("role", "row")
  })

  test("each bulk action passes every exercise in the part to its callback", async () => {
    const onDownloadAll = vi.fn()
    const onOpenAll = vi.fn()
    const onCloseAll = vi.fn()
    renderPart({
      exerciseGroup: twoExerciseGroup(),
      statuses: { 101: "opened", 102: "missing" },
      onDownloadAll,
      onOpenAll,
      onCloseAll,
    })
    const ids = [makeTmcKind({ tmcExerciseId: 101 }), makeTmcKind({ tmcExerciseId: 102 })]

    ;(await screen.findByRole("button", { name: "Download all in part01" })).click()
    ;(await screen.findByRole("button", { name: "Open all in part01" })).click()
    ;(await screen.findByRole("button", { name: "Close all in part01" })).click()

    expect(onDownloadAll).toHaveBeenCalledWith(ids)
    expect(onOpenAll).toHaveBeenCalledWith(ids)
    expect(onCloseAll).toHaveBeenCalledWith(ids)
  })

  test("disables a bulk action that has nothing left to do", async () => {
    renderPart({ statuses: { 101: "closed" } })

    expect(await screen.findByRole("button", { name: "Download all in part01" })).toHaveProperty(
      "disabled",
      true,
    )
    expect(await screen.findByRole("button", { name: "Open all in part01" })).toHaveProperty(
      "disabled",
      false,
    )
    expect(await screen.findByRole("button", { name: "Close all in part01" })).toHaveProperty(
      "disabled",
      true,
    )
  })

  test("names each checkbox after what it selects", async () => {
    const { container } = renderPart()

    const [selectAll, row] = container.querySelectorAll("vscode-checkbox")
    const selectAllInput = (await withinShadowRoot(selectAll!)).getByRole("checkbox")
    const rowInput = (await withinShadowRoot(row!)).getByRole("checkbox")
    expect(selectAllInput).toHaveAccessibleName("Select all in part01")
    expect(rowInput).toHaveAccessibleName("Select part01-01_hello")
  })

  test("marks select-all as mixed while only some exercises are selected", async () => {
    const checkedExercises = emptySelection()
    const hello = makeTmcKind({ tmcExerciseId: 101 })
    checkedExercises.set(ExerciseIdentifier.toString(hello), hello)
    const { container } = renderPart({ exerciseGroup: twoExerciseGroup(), checkedExercises })

    const selectAll = container.querySelector("vscode-checkbox")!
    const input = (await withinShadowRoot(selectAll)).getByRole("checkbox")
    expect(input).toHaveProperty("indeterminate", true)
  })

  // Unchecking has to remove the entry, not record `false`: the panel counts entries.
  test("adds a checked exercise to the selection and drops it again when unchecked", async () => {
    const checkedExercises = emptySelection()
    const { container } = renderPart({ checkedExercises })

    const selectAll = container.querySelector("vscode-checkbox")
    expect(selectAll).not.toBeNull()

    await fireEvent.keyDown(selectAll!, { key: " " })
    expect([...checkedExercises.values()]).toEqual([makeTmcKind({ tmcExerciseId: 101 })])

    await fireEvent.keyDown(selectAll!, { key: " " })
    expect(checkedExercises.size).toBe(0)
  })
})
