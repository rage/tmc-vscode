import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { BrowserContext, CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

// `pnpm run test:a11y` builds this with `vite build --config dev/vite.config.ts` first.
const HARNESS_DIST = join(import.meta.dirname, "..", "dev", "dist")
const SCENARIO_IDS = JSON.parse(
  readFileSync(join(HARNESS_DIST, "scenarios.json"), "utf8"),
) as string[]
const ORIGIN = "http://harness.test"

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
  await page.goto(`${ORIGIN}/frame.html?scenario=initialization-error-help%2Ferrors`)
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
