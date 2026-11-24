import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

import type { BrowserContext, CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import type AxeCore from "axe-core"

// `pnpm run test:a11y` builds this with `vite build --config dev/vite.config.ts` first.
const HARNESS_DIST = join(import.meta.dirname, "..", "dev", "dist")
const SCENARIO_IDS = JSON.parse(
  readFileSync(join(HARNESS_DIST, "scenarios.json"), "utf8"),
) as string[]
const ORIGIN = "http://harness.test"
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
)
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Runs axe-core over the page and lists what it flags, as `rule: target`. */
async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE })
  return page.evaluate(async (tags) => {
    const { axe } = window as unknown as { axe: typeof AxeCore }
    const { violations } = await axe.run(document, { runOnly: { type: "tag", values: tags } })
    return violations.flatMap(({ id, nodes }) =>
      nodes.map((node) => `${id}: ${node.target.join(" ")}`),
    )
  }, AXE_TAGS)
}

const NAMED_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
])
const LIVE_ROLES = new Set(["alert", "status", "log", "marquee", "timer"])

/**
 * Checks that fail today, keyed `"<scenario> › <check>"`. Each is a product bug: fix it and
 * delete the entry, and the check starts guarding it.
 */
const KNOWN_FAILURES: Record<string, string> = {}

interface AxNode {
  nodeId: string
  parentId?: string
  backendDOMNodeId?: number
  ignored: boolean
  role?: { value: string }
  name?: { value: string }
  properties?: { name: string; value: { value: unknown } }[]
}

function property(node: AxNode, name: string): unknown {
  return node.properties?.find((candidate) => candidate.name === name)?.value.value
}

function describeNode(node: AxNode): string {
  return `${node.role?.value ?? "?"} "${node.name?.value ?? ""}"`
}

async function serveHarness(context: BrowserContext): Promise<void> {
  await context.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    try {
      await route.fulfill({ path: join(HARNESS_DIST, pathname) })
    } catch {
      await route.fulfill({ status: 404 })
    }
  })
}

test("the harness build lists its scenarios", () => {
  expect(SCENARIO_IDS.length).toBeGreaterThan(0)
})

for (const scenarioId of SCENARIO_IDS) {
  test.describe(scenarioId, () => {
    let page: Page
    let cdp: CDPSession
    let nodes: AxNode[]

    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext()
      await serveHarness(context)
      page = await context.newPage()
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text())
        }
      })
      await page.goto(`${ORIGIN}/frame.html?scenario=${encodeURIComponent(scenarioId)}`)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      // Pushed messages and the elements' own first render land within a few tasks.
      await page.waitForTimeout(300)
      expect(errors, "the panel logged errors").toEqual([])
      cdp = await context.newCDPSession(page)
      nodes = ((await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] }).nodes
    })

    test.afterAll(async () => {
      await page.context().close()
    })

    function check(name: string, body: () => Promise<void> | void): void {
      test(name, async () => {
        const knownFailure = KNOWN_FAILURES[`${scenarioId} › ${name}`]
        test.fail(knownFailure !== undefined, knownFailure)
        await body()
      })
    }

    const visible = () => nodes.filter((node) => !node.ignored)
    const byId = () => new Map(nodes.map((node) => [node.nodeId, node]))
    const ancestors = (node: AxNode): AxNode[] => {
      const index = byId()
      const chain: AxNode[] = []
      for (
        let parent = index.get(node.parentId ?? "");
        parent;
        parent = index.get(parent.parentId ?? "")
      ) {
        chain.push(parent)
      }
      return chain
    }

    check("every control has an accessible name", () => {
      const unnamed = visible().filter(
        (node) => NAMED_ROLES.has(node.role?.value ?? "") && !node.name?.value.trim(),
      )
      expect(unnamed.map((node) => describeNode(node))).toEqual([])
    })

    check("has one level-1 heading", () => {
      const headings = visible().filter(
        (node) => node.role?.value === "heading" && property(node, "level") === 1,
      )
      expect(headings.map((node) => describeNode(node))).toHaveLength(1)
    })

    check("spinners and live regions do not interrupt or nest", () => {
      const live = visible().filter((node) => LIVE_ROLES.has(node.role?.value ?? ""))
      const alerts = live.filter((node) => node.role?.value === "alert")
      expect(
        alerts.length,
        `alerts: ${alerts.map((node) => describeNode(node)).join(", ")}`,
      ).toBeLessThanOrEqual(1)
      const progressInsideAlert = visible().filter(
        (node) =>
          node.role?.value === "progressbar" &&
          ancestors(node).some((ancestor) => ancestor.role?.value === "alert"),
      )
      expect(progressInsideAlert.map((node) => describeNode(node))).toEqual([])
      const nested = live.filter((node) =>
        ancestors(node).some((ancestor) => LIVE_ROLES.has(ancestor.role?.value ?? "")),
      )
      expect(nested.map((node) => describeNode(node))).toEqual([])
    })

    check("passes axe-core's WCAG A and AA rules", async () => {
      expect(await axeViolations(page)).toEqual([])
    })

    check("disclosures expose aria-expanded matching what they show", async () => {
      const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
        root: { nodeId: number }
      }
      const { nodeIds } = (await cdp.send("DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector: "[aria-controls]",
      })) as { nodeIds: number[] }
      const byBackendId = new Map(nodes.map((node) => [node.backendDOMNodeId, node]))
      const problems: string[] = []
      for (const nodeId of nodeIds) {
        const { node: domNode } = (await cdp.send("DOM.describeNode", { nodeId })) as {
          node: { backendNodeId: number; localName: string; attributes?: string[] }
        }
        const attributes = domNode.attributes ?? []
        const controls = attributes[attributes.indexOf("aria-controls") + 1]
        const axNode = byBackendId.get(domNode.backendNodeId)
        const expanded = axNode ? property(axNode, "expanded") : undefined
        if (expanded === undefined) {
          problems.push(`${domNode.localName} exposes no expanded state`)
          continue
        }
        if (!controls) {
          continue
        }
        const isShown = await page.evaluate((id) => {
          const region = document.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
          return region !== null && !region.hidden && region.getClientRects().length > 0
        }, controls)
        if (isShown !== expanded) {
          problems.push(`${describeNode(axNode as AxNode)} says expanded=${String(expanded)}`)
        }
      }
      expect(problems).toEqual([])
    })
  })
}

test("a disclosure reports the state it toggles to", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=error-help%2Fstartup`)
  const toggle = page.getByRole("button", { name: /^Stack trace of / })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  const cdp = await context.newCDPSession(page)
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] }
  const axToggle = nodes.find(
    (node) => node.role?.value === "button" && node.name?.value.startsWith("Stack trace of "),
  )
  expect(axToggle && property(axToggle, "expanded")).toBe(true)
})

test("the overflow menu is reachable and operable from the keyboard", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=exercise-submission%2Ftmc-failed`)
  const trigger = page.getByRole("button", { name: "More Actions" })
  await trigger.focus()
  await page.keyboard.press("ArrowDown")
  const menu = page.getByRole("menu", { name: "More Actions" })
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(menu.getByRole("menuitem").first()).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test("a course is found and added from the keyboard alone", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=add-course%2Fcourses`)
  await expect(page.getByRole("heading", { level: 1, name: "Add Course" })).toBeFocused()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("searchbox", { name: "Search courses and organizations" }),
  ).toBeFocused()
  await page.keyboard.type("everything")
  await page.keyboard.press("Tab")
  const add = page.getByRole("button", { name: "Add Introduction to everything" })
  await expect(add).toBeFocused()
  await page.keyboard.press("Enter")
  const posted = await page.evaluate(
    () => (window as unknown as { tmcHarness: { posted: { type: string }[] } }).tmcHarness.posted,
  )
  expect(posted.map((message) => message.type)).toContain("addCourse")
})

test("the login screen's buttons follow the code in keyboard order", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=login%2Fwaiting`)
  await expect(page.getByText("WXYZ-0001")).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Copy" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Open MOOC.fi" })).toBeFocused()
  await page.keyboard.press("Enter")
  const posted = await page.evaluate(
    () =>
      (window as unknown as { tmcHarness: { posted: { type: string; action?: string }[] } })
        .tmcHarness.posted,
  )
  expect(posted).toContainEqual(
    expect.objectContaining({ type: "loginAction", action: "openVerificationPage" }),
  )
})

test("History's refresh follows its toggle in keyboard order", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=exercise-submission%2Fmooc-history`)
  const toggle = page.getByRole("button", { name: "History", exact: true })
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await toggle.focus()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Refresh History" })).toBeFocused()
})

test("a course notice's action comes before its dismiss in keyboard order", async ({
  context,
  page,
}) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=course-details%2Faction-failed`)
  const notices = page.getByRole("list", { name: "Course notices" })
  await notices.getByRole("button", { name: "Download", exact: true }).focus()
  await page.keyboard.press("Tab")
  await expect(notices.getByRole("button", { name: "Dismiss the new exercises" })).toBeFocused()
})

// 400% zoom on a 1280px-wide window is a 320px-wide viewport (WCAG 2.2 SC 1.4.10).
for (const scenarioId of SCENARIO_IDS) {
  test(`${scenarioId} reflows at 320px without scrolling sideways`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 256 } })
    try {
      await serveHarness(context)
      const page = await context.newPage()
      await page.goto(`${ORIGIN}/frame.html?scenario=${encodeURIComponent(scenarioId)}`)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0)
      expect(await axeViolations(page)).toEqual([])
    } finally {
      await context.close()
    }
  })
}

test("focus returns to the Add button after an add fails", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=add-course%2Fcourses`)
  const add = page.getByRole("button", { name: "Add Introduction to everything" })
  await add.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Could not add the course.")).toBeVisible()
  await expect(add).toBeFocused()
})

test("focus returns to Restore after a restore settles", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=exercise-submission%2Fmooc-history`)
  const first = page.getByRole("button", { name: /^Restore the / }).first()
  const name = (await first.getAttribute("aria-label")) ?? ""
  await first.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText(/^Restored the /)).toBeVisible()
  await expect(page.getByRole("button", { name, exact: true })).toBeFocused()
})

test("focus moves to Copy Link after the paste link arrives", async ({ context, page }) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=exercise-submission%2Fmooc-get-help`)
  await page.getByRole("button", { name: "Send Again" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Copy Link" })).toBeFocused()
})

test("dismissing failures moves focus to the next one, then to the heading", async ({
  context,
  page,
}) => {
  await serveHarness(context)
  await page.goto(`${ORIGIN}/frame.html?scenario=course-details%2Faction-failed`)
  await page.getByRole("button", { name: "Dismiss this error" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Dismiss this warning" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
})
