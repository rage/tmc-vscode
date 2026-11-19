import type { MenuContext } from "../support/manifestMenus"
import { evaluateWhen, manifestMenu, shownMenu } from "../support/manifestMenus"

/** The commands the Courses view's context menu offers on a row. */
function menuFor(viewItem: string, options: { isLoggedIn: boolean }): string[] {
  const context: MenuContext = {
    view: "tmcView",
    viewItem,
    "test-my-code:Initialized": true,
    "test-my-code:LoggedIn": options.isLoggedIn,
    listMultiSelection: false,
  }
  return shownMenu("view/item/context", context)
}

suite("the Courses view's context menu", function () {
  test("the evaluator reads the manifest's syntax", function () {
    expect(evaluateWhen("a && (b || !c)", { a: true, b: false, c: false })).toBe(true)
    expect(evaluateWhen("a && (b || !c)", { a: true, b: false, c: true })).toBe(false)
    expect(evaluateWhen("view == tmcView", { view: "tmcView" })).toBe(true)
    expect(evaluateWhen("x =~ /^exercise\\.(a|b)(\\.|$)/", { x: "exercise.b.passed" })).toBe(true)
  })

  test("offers logging in, and the material page, on an exercise not downloaded while logged out", function () {
    expect(menuFor("exercise.missing.hasMaterial", { isLoggedIn: false })).toEqual([
      "tmc.showMoocLogin",
      "tmc.openExerciseMaterial",
    ])
    expect(menuFor("exercise.new", { isLoggedIn: false })).toEqual(["tmc.showMoocLogin"])
  })

  test("offers what runs locally on an exercise on disk while logged out", function () {
    expect(menuFor("exercise.opened", { isLoggedIn: false })).toEqual([
      "tmc.testExercise",
      "tmc.openNextExercise",
      "tmc.cleanExercise",
      "tmc.closeExercises",
    ])
    expect(menuFor("exercise.closed", { isLoggedIn: false })).toEqual(["tmc.openExercises"])
  })

  test("offers what runs locally on a removed exercise still on disk", function () {
    for (const isLoggedIn of [true, false]) {
      expect(menuFor("exercise.removed.opened", { isLoggedIn })).toEqual([
        "tmc.testExercise",
        "tmc.openNextExercise",
        "tmc.cleanExercise",
        "tmc.closeExercises",
      ])
      expect(menuFor("exercise.removed.closed", { isLoggedIn })).toEqual(["tmc.openExercises"])
    }
  })

  test("offers the backend's actions too on an open exercise while logged in", function () {
    expect(
      menuFor("exercise.opened.passed.hasMaterial.hasModelSolution", { isLoggedIn: true }),
    ).toEqual([
      "tmc.testExercise",
      "tmc.submitExercise",
      "tmc.showExerciseResults",
      "tmc.pasteExercise",
      "tmc.downloadOldSubmission",
      "tmc.resetExercise",
      "tmc.openNextExercise",
      "tmc.showModelSolution",
      "tmc.openExerciseMaterial",
      "tmc.cleanExercise",
      "tmc.closeExercises",
    ])
    expect(menuFor("exercise.opened", { isLoggedIn: true })).not.toContain("tmc.showModelSolution")
  })

  test("leaves Submit out of an exercise whose submission the backend would refuse", function () {
    const menu = menuFor("exercise.opened.passed.submitRefused", { isLoggedIn: true })
    expect(menu).not.toContain("tmc.submitExercise")
    expect(menu).toEqual(expect.arrayContaining(["tmc.testExercise", "tmc.pasteExercise"]))
    expect(menuFor("exercise.opened.updateable", { isLoggedIn: true })).toContain(
      "tmc.submitExercise",
    )
  })
})

suite("the Explorer's TestMyCode menu", function () {
  test("offers only Run Tests, Submit, Get Help and History, and Submit only while logged in", function () {
    const context = { "test-my-code:Initialized": true, "test-my-code:WorkspaceActive": true }

    expect(shownMenu("tmc.exercise", { ...context, "test-my-code:LoggedIn": true })).toEqual([
      "tmc.testExercise",
      "tmc.submitExercise",
      "tmc.pasteExercise",
      "tmc.downloadOldSubmission",
    ])
    expect(shownMenu("tmc.exercise", { ...context, "test-my-code:LoggedIn": false })).toEqual([
      "tmc.testExercise",
    ])
  })
})

suite("the command palette in a light window", function () {
  test("offers the entry commands, which start the full activation, and nothing else", function () {
    const palette = manifestMenu("commandPalette")
    const shown = palette
      .filter(
        (entry) =>
          entry.when === undefined || evaluateWhen(entry.when, { "test-my-code:Light": true }),
      )
      .map((entry) => entry.command)

    expect(shown.toSorted()).toEqual(["tmc.addNewCourse", "tmc.myCourses", "tmc.showMoocLogin"])
  })
})
