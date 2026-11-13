import * as fs from "fs"
import * as path from "path"

interface MenuEntry {
  command: string
  group?: string
  when?: string
}

type Context = Record<string, string | boolean>

function treeContextMenu(): MenuEntry[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as { contributes: { menus: Record<string, MenuEntry[]> } }
  return manifest.contributes.menus["view/item/context"] ?? []
}

/**
 * Evaluates the subset of VS Code's `when` syntax package.json uses: keys, `!`, `==`, `=~`
 * with a regex literal, `&&`, `||` and parentheses.
 */
function evaluateWhen(when: string, context: Context): boolean {
  const tokens = [...when.matchAll(/\s*(\/(?:\\.|[^/])*\/|&&|\|\||==|=~|[!()]|[^\s!()&|=]+)/g)].map(
    (match) => match[1] ?? "",
  )
  let position = 0
  const peek = (): string | undefined => tokens[position]
  const next = (): string => tokens[position++] ?? ""

  function or(): boolean {
    let value = and()
    while (peek() === "||") {
      next()
      value = and() || value
    }
    return value
  }
  function and(): boolean {
    let value = unary()
    while (peek() === "&&") {
      next()
      value = unary() && value
    }
    return value
  }
  function unary(): boolean {
    const token = next()
    if (token === "!") {
      return !unary()
    }
    if (token === "(") {
      const value = or()
      next()
      return value
    }
    const value = context[token]
    if (peek() === "==") {
      next()
      return String(value) === next()
    }
    if (peek() === "=~") {
      next()
      const literal = next()
      return new RegExp(literal.slice(1, literal.lastIndexOf("/"))).test(String(value ?? ""))
    }
    return value !== undefined && value !== false
  }

  return or()
}

/** The commands the Courses view's context menu offers on a row. */
function menuFor(viewItem: string, options: { isLoggedIn: boolean }): string[] {
  const context: Context = {
    view: "tmcView",
    viewItem,
    "test-my-code:Initialized": true,
    "test-my-code:LoggedIn": options.isLoggedIn,
    listMultiSelection: false,
  }
  return treeContextMenu()
    .filter((entry) => !entry.group?.startsWith("inline"))
    .filter((entry) => evaluateWhen(entry.when ?? "", context))
    .map((entry) => entry.command)
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
      "tmc.closeExercises",
      "tmc.testExercise",
      "tmc.cleanExercise",
    ])
    expect(menuFor("exercise.closed", { isLoggedIn: false })).toEqual(["tmc.openExercises"])
  })

  test("offers what runs locally on a removed exercise still on disk", function () {
    for (const isLoggedIn of [true, false]) {
      expect(menuFor("exercise.removed.opened", { isLoggedIn })).toEqual([
        "tmc.closeExercises",
        "tmc.testExercise",
        "tmc.cleanExercise",
      ])
      expect(menuFor("exercise.removed.closed", { isLoggedIn })).toEqual(["tmc.openExercises"])
    }
  })

  test("offers the backend's actions too on an open exercise while logged in", function () {
    expect(menuFor("exercise.opened.hasMaterial", { isLoggedIn: true })).toEqual(
      expect.arrayContaining([
        "tmc.submitExercise",
        "tmc.pasteExercise",
        "tmc.resetExercise",
        "tmc.openExerciseMaterial",
      ]),
    )
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
