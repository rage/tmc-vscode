import { expect } from "@playwright/test"
import type { FrameLocator, Locator, Page } from "@playwright/test"

import { LEGACY_USERNAME } from "../../backend/mockSession"

/**
 * Drives the 3.5.5 UI, which no current page object knows: a Menu tree view and one webview
 * panel, with organizations and courses picked in a second panel beside it.
 */
export class LegacyTmcPage {
  public constructor(public readonly page: Page) {}

  /** The extension's main panel: login, My Courses and Course Details. */
  public panel(): FrameLocator {
    return this.page
      .frameLocator("iframe.webview.ready")
      .last()
      .frameLocator('iframe#active-frame[title="TestMyCode"]')
  }

  private sidePanel(): FrameLocator {
    return this.page.frameLocator(".webview.ready").last().frameLocator("iframe#active-frame")
  }

  /** A `vscode-button`, whose shadow DOM holds a second element with the button role. */
  private button(name: string): Locator {
    return this.panel().getByRole("button", { name, exact: true }).first()
  }

  public menuItem(name: string): Locator {
    return this.page.getByRole("treeitem", { name }).locator("a")
  }

  public async openMenu(): Promise<void> {
    const heading = this.page.getByRole("heading", { name: "TestMyCode: Menu" })
    // The activity bar entry opens nothing until the extension has activated.
    await expect(async () => {
      if (!(await heading.isVisible())) {
        await this.page
          .locator('[id="workbench\\.parts\\.activitybar"]')
          .getByRole("tab", { name: "TestMyCode" })
          .locator("a")
          .click()
      }
      await expect(heading).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
  }

  /** Clicks the Menu item `name` until `screen` shows: an early click is lost while the tree loads. */
  private async openFromMenu(name: string, screen: Locator): Promise<void> {
    await this.openMenu()
    await expect(async () => {
      await this.menuItem(name).click({ timeout: 2_000 })
      await expect(screen).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
  }

  public async logIn(): Promise<void> {
    await this.openFromMenu(
      "Log in",
      this.panel().getByRole("textbox", { name: "Email or username:" }),
    )
    await this.panel().getByRole("textbox", { name: "Email or username:" }).fill(LEGACY_USERNAME)
    await this.panel().getByRole("textbox", { name: "Password:" }).first().fill(LEGACY_USERNAME)
    await this.button("Log in").click()
    await expect(this.menuItem("Log out")).toBeVisible()
  }

  public async openMyCourses(): Promise<void> {
    await this.openFromMenu("My Courses", this.button("Add new course"))
  }

  /** The heading My Courses shows for the course titled `title` named `name`. */
  public courseHeading(title: string, name: string): Locator {
    return this.panel().getByRole("heading", { name: `${title} (${name})` })
  }

  public async addCourse(title: string, name: string): Promise<void> {
    await this.openMyCourses()
    await this.button("Add new course").click()
    await this.sidePanel().getByRole("heading", { name: "Test Organization (test)" }).click()
    // The organization list closes before the course list replaces it.
    await expect(async () => {
      await this.sidePanel().getByRole("heading", { name: title }).click({ timeout: 2_000 })
    }).toPass()
    await expect(this.courseHeading(title, name)).toBeVisible()
  }

  public async openCourse(title: string, name: string): Promise<void> {
    await this.openMyCourses()
    await this.courseHeading(title, name).click()
    await expect(this.button("Show exercises")).toBeVisible()
  }

  /** The row of the exercise labelled `exercise` on Course Details, such as "01_passing_exercise". */
  private exerciseRow(exercise: string): Locator {
    return this.panel().getByRole("row", { name: new RegExp(`\\b${exercise}\\b`) })
  }

  /** The status of the exercise labelled `exercise` on Course Details, such as "opened". */
  public exerciseStatus(exercise: string): Locator {
    return this.exerciseRow(exercise).getByRole("cell").last()
  }

  /**
   * Downloads and opens the course's one part, `exercises` being its labels. 3.5.5's part counters
   * do not update and nothing marks a download's end, so opening is retried until it takes.
   */
  public async downloadAndOpenAll(exercises: string[]): Promise<void> {
    await this.button("Download all").click()
    await expect(async () => {
      await this.button("Open all").click()
      for (const exercise of exercises) {
        await expect(this.exerciseStatus(exercise)).toHaveText("opened", { timeout: 3_000 })
      }
    }).toPass({ timeout: 60_000 })
  }

  public async showExercises(): Promise<void> {
    await this.button("Show exercises").click()
  }

  public async closeExercise(exercise: string): Promise<void> {
    await this.exerciseRow(exercise).getByRole("button", { name: "Checkbox" }).first().click()
    await this.button("Close").click()
    await expect(this.exerciseStatus(exercise)).toHaveText("closed")
  }
}
