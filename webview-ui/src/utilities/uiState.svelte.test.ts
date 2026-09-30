import { render } from "@testing-library/svelte"

import App from "../App.svelte"
import type { Panel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import { initializationErrorHelpPanel } from "../test/fixtures"
import { dispatchToWebview, reloadDocument, savedWebviewState } from "../test/setup"
import { enterScreen, restoreScroll, uiState } from "./uiState.svelte"

const courseDetails: Panel = {
  id: 4,
  type: "CourseDetails",
  courseId: makeTmcKind({ courseId: 42 }),
}

// The state bag `acquireVsCodeApi()` hands out, written here as another build could have left it.
function seedRawState(state: unknown): void {
  ;(acquireVsCodeApi() as { setState: (state: unknown) => void }).setState(state)
}

suite("UI state across a document reload", () => {
  test("gives a value back to the same screen", () => {
    enterScreen(courseDetails)
    uiState("showPassedTests", false).current = true

    reloadDocument()
    enterScreen(courseDetails)

    expect(uiState("showPassedTests", false).current).toBe(true)
  })

  test("counts another panel of the same course as the same screen", () => {
    enterScreen(courseDetails)
    uiState("section", "points").current = "deadlines"

    reloadDocument()
    enterScreen({ ...courseDetails, id: 99 })

    expect(uiState("section", "points").current).toBe("deadlines")
  })

  test("drops a value when another screen is entered", () => {
    enterScreen(courseDetails)
    uiState("showPassedTests", false).current = true

    enterScreen({
      id: 5,
      type: "CourseDetails",
      courseId: makeMoocKind({ instanceId: "42" }),
    })

    expect(uiState("showPassedTests", false).current).toBe(false)
    expect(savedWebviewState()?.ui).toEqual({})
  })

  test("a component of a screen already left writes nothing into the next", () => {
    enterScreen(courseDetails)
    const stale = uiState("showPassedTests", false)
    enterScreen(initializationErrorHelpPanel())

    stale.current = true

    expect(savedWebviewState()?.ui).toEqual({})
  })

  test("ignores a saved value of another kind", () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { showPassedTests: "yes" } })

    enterScreen(courseDetails)

    expect(uiState("showPassedTests", false).current).toBe(false)
  })

  test("starts empty from a state bag it cannot read", () => {
    seedRawState({ panel: "something older" })

    enterScreen(courseDetails)

    expect(uiState("showPassedTests", false).current).toBe(false)
    expect(savedWebviewState()).toMatchObject({ screen: "CourseDetails:tmc:42", ui: {} })
  })
})

/** Scrolls the page as the student would, firing the event the page sees. */
function scrollWindowTo(scrollY: number): void {
  vi.spyOn(window, "scrollY", "get").mockReturnValue(scrollY)
  window.dispatchEvent(new Event("scroll"))
}

suite("scroll position across a document reload", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("saves where the student scrolled to once the scrolling settles", () => {
    enterScreen(courseDetails)

    scrollWindowTo(120)
    scrollWindowTo(240)
    expect(savedWebviewState()?.ui.scrollY).toBeUndefined()
    vi.advanceTimersByTime(1000)

    expect(savedWebviewState()?.ui.scrollY).toBe(240)
  })

  test("saves a scroll still settling when the document is hidden", () => {
    enterScreen(courseDetails)

    scrollWindowTo(240)
    window.dispatchEvent(new Event("pagehide"))

    expect(savedWebviewState()?.ui.scrollY).toBe(240)
  })

  test("scrolls back there on the same screen once its content is in", () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    enterScreen(courseDetails)
    expect(scroll).not.toHaveBeenCalled()
    restoreScroll()

    expect(scroll).toHaveBeenCalledWith(0, 240)
  })

  test("does not let scrolls before the restore overwrite its target", () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    enterScreen(courseDetails)
    scrollWindowTo(80)
    vi.advanceTimersByTime(1000)

    expect(savedWebviewState()?.ui.scrollY).toBe(240)
  })

  test("saves the student's scrolls after the restore", () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    enterScreen(courseDetails)
    restoreScroll()
    scrollWindowTo(80)
    vi.advanceTimersByTime(1000)

    expect(savedWebviewState()?.ui.scrollY).toBe(80)
  })
})

suite("the screen a window reload reopens", () => {
  test("is saved for Course Details", () => {
    enterScreen(courseDetails)

    expect(savedWebviewState()?.route).toEqual({
      type: "CourseDetails",
      courseId: makeTmcKind({ courseId: 42 }),
    })
  })

  test("is not saved for a submission, whose view the reload clears", () => {
    enterScreen(courseDetails)

    enterScreen({
      id: 7,
      type: "ExerciseSubmission",
      backend: "tmc",
      courseSlug: "python-course",
      exerciseSlug: "part01-01_hello",
    })

    expect(savedWebviewState()).not.toHaveProperty("route")
  })
})

suite("App and UI state", () => {
  test("enters the screen of each panel the host sets", () => {
    render(App)

    dispatchToWebview({ type: "setPanel", panel: courseDetails })

    expect(savedWebviewState()?.screen).toBe("CourseDetails:tmc:42")
  })
})
