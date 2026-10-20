import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { BrowserContext } from "@playwright/test"
import { expect, test } from "@playwright/test"

// `pnpm run test:visual` builds this with `vite build --config dev/vite.config.ts` first.
const HARNESS_DIST = join(import.meta.dirname, "..", "dev", "dist")
const SCENARIO_IDS = JSON.parse(
  readFileSync(join(HARNESS_DIST, "scenarios.json"), "utf8"),
) as string[]
const ORIGIN = "http://harness.test"

const THEMES = {
  light: "Light Modern",
  dark: "Dark Modern",
  hc: "Default High Contrast",
} as const

// The themes name system-ui and Droid Sans Mono, which differ from machine to machine.
const PINNED_FONTS = `
  html {
    --vscode-font-family: "DejaVu Sans", sans-serif !important;
    --vscode-editor-font-family: "DejaVu Sans Mono", monospace !important;
  }
`

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

test.use({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "Europe/Helsinki",
})

for (const scenarioId of SCENARIO_IDS) {
  for (const [themeKey, themeId] of Object.entries(THEMES)) {
    test(`${scenarioId} in ${themeId}`, async ({ context, page }) => {
      await page.clock.setFixedTime(new Date("2026-10-01T09:00:00Z"))
      await serveHarness(context)
      const query = new URLSearchParams({ scenario: scenarioId, theme: themeId, reduceMotion: "1" })
      await page.goto(`${ORIGIN}/frame.html?${query}`)
      await page.addStyleTag({ content: PINNED_FONTS })
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`${scenarioId.replace("/", "--")}-${themeKey}.png`, {
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      })
    })
  }
}
