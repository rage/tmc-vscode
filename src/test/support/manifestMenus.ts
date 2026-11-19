import * as fs from "fs"
import * as path from "path"

/** One entry of a `contributes.menus` list in package.json. */
export interface MenuEntry {
  command: string
  group?: string
  when?: string
}

/** The context keys a `when` clause reads. */
export type MenuContext = Record<string, string | boolean>

/** The entries package.json contributes to `menuId`, in manifest order. */
export function manifestMenu(menuId: string): MenuEntry[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as { contributes: { menus: Record<string, MenuEntry[]> } }
  return manifest.contributes.menus[menuId] ?? []
}

function placeOf(entry: MenuEntry): [group: string, order: number] {
  const [group = "", order = "0"] = (entry.group ?? "").split("@")
  return [group, Number(order)]
}

/** The commands `menuId` shows in `context`, outside its inline group, in VS Code's order. */
export function shownMenu(menuId: string, context: MenuContext): string[] {
  return manifestMenu(menuId)
    .filter((entry) => !entry.group?.startsWith("inline"))
    .filter((entry) => evaluateWhen(entry.when ?? "", context))
    .toSorted((a, b) => {
      const [groupA, orderA] = placeOf(a)
      const [groupB, orderB] = placeOf(b)
      return groupA === groupB ? orderA - orderB : groupA < groupB ? -1 : 1
    })
    .map((entry) => entry.command)
}

/** The title package.json gives `command`. */
export function commandTitle(command: string): string | undefined {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
  ) as { contributes: { commands: { command: string; title: string }[] } }
  return manifest.contributes.commands.find((declared) => declared.command === command)?.title
}

/**
 * Evaluates the subset of VS Code's `when` syntax package.json uses: keys, `!`, `==`, `=~`
 * with a regex literal, `&&`, `||` and parentheses.
 */
export function evaluateWhen(when: string, context: MenuContext): boolean {
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
