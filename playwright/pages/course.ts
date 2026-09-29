import type { Locator } from "@playwright/test"

import { TmcPage } from "./tmc"

export class CoursePage extends TmcPage {
  public async openWorkspace(): Promise<void> {
    await this.webview.getByRole("button", { name: "Open workspace" }).first().click()
  }

  /** The heading of the exercise group (part) named `name`; a mooc course has one, named after it. */
  public exerciseGroupHeading(name: string): Locator {
    return this.webview.getByRole("heading", { level: 2, name })
  }

  /** Expands every collapsed exercise group (part). */
  public async showExercises(): Promise<void> {
    const collapsed = this.getSidePanel()
      .getByRole("heading", { level: 2 })
      .getByRole("button", { expanded: false })
    while ((await collapsed.count()) > 0) {
      await collapsed.first().click()
    }
  }

  public async openExercises(names: string[]): Promise<void> {
    const panel = this.getSidePanel()
    for (const name of names) {
      // The named input is visually hidden inside the element; clicking the host is what a user does.
      const input = panel.getByRole("checkbox", { name: `Select ${name}`, exact: true })
      await panel.locator("vscode-checkbox").filter({ has: input }).click()
    }
    await panel.getByRole("button", { name: "Open", exact: true }).first().click()
  }
}
