import { render } from "@testing-library/svelte"

import App from "../App.svelte"
import type { Panel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import { tmcLocalCourse, tmcLocalExercise } from "../test/fixtures"
import { dispatchToWebview, reloadDocument, savedWebviewState } from "../test/setup"
import { enterScreen, uiState } from "./uiState.svelte"

const courseDetails: Panel = {
  id: 4,
  type: "CourseDetails",
  courseId: makeTmcKind({ courseId: 42 }),
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
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
    enterScreen({ id: 6, type: "InitializationErrorHelp" })

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

suite("scroll position across a document reload", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("saves where the student scrolled to", async () => {
    enterScreen(courseDetails)
    vi.spyOn(window, "scrollY", "get").mockReturnValue(240)

    window.dispatchEvent(new Event("scroll"))
    await nextFrame()

    expect(savedWebviewState()?.ui.scrollY).toBe(240)
  })

  test("scrolls back there on the same screen", async () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    enterScreen(courseDetails)
    await nextFrame()

    expect(scrollTo).toHaveBeenCalledWith(0, 240)
  })

  test("does not let the scrolls of a restore still under way overwrite its target", async () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    vi.spyOn(window, "scrollY", "get").mockReturnValue(80)

    enterScreen(courseDetails)
    window.dispatchEvent(new Event("scroll"))
    await nextFrame()

    expect(savedWebviewState()?.ui.scrollY).toBe(240)
  })

  test("gives the restore up once the student scrolls themselves", async () => {
    seedRawState({ screen: "CourseDetails:tmc:42", ui: { scrollY: 240 } })
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    vi.spyOn(window, "scrollY", "get").mockReturnValue(80)

    enterScreen(courseDetails)
    window.dispatchEvent(new WheelEvent("wheel"))
    window.dispatchEvent(new Event("scroll"))
    await nextFrame()

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
      course: tmcLocalCourse(),
      exercise: tmcLocalExercise(),
    })

    expect(savedWebviewState()).not.toHaveProperty("route")
  })
})

suite("App and UI state", () => {
  test("enters the screen of each panel the host sets", () => {
    render(App)

    dispatchToWebview({ type: "setPanel", target: { id: 0, type: "App" }, panel: courseDetails })

    expect(savedWebviewState()?.screen).toBe("CourseDetails:tmc:42")
  })
})
