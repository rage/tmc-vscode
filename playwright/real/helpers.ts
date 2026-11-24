import { join } from "node:path"

import type { Page } from "@playwright/test"

import type { CoursesViewPage } from "../pages/courses-view"

import { dirs } from "./harness"

const EXERCISE = "python3_simple"

export async function dumpTree(page: Page): Promise<void> {
  const names = await page
    .locator(".pane-body .monaco-list")
    .getByRole("treeitem")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent))
  console.log("TREE:", JSON.stringify(names, null, 1))
}

export function exerciseDir(slug = "introduction-to-everything", exercise = EXERCISE): string {
  return join(dirs.projects, "vscode", "mooc", slug, exercise)
}

export async function toasts(page: Page): Promise<string[]> {
  return page.locator(".notifications-toasts .notification-toast").allTextContents()
}

/** Expands chapter rows until `label` is visible. */
export async function revealRow(page: Page, coursesView: CoursesViewPage, label: string): Promise<void> {
  const target = coursesView.row(label).first()
  for (let attempt = 0; attempt < 5 && !(await target.isVisible()); attempt++) {
    const collapsed = coursesView.tree().getByRole("treeitem", { expanded: false })
    const count = await collapsed.count()
    for (let i = 0; i < count; i++) {
      await collapsed.nth(i).click()
      await page.waitForTimeout(500)
      if (await target.isVisible()) return
    }
  }
}

