import { expect } from "@playwright/test"
import type { FrameLocator, Locator, Page } from "@playwright/test"

/**
 * The add-course screen in the main panel, driven by its accessible names
 * (webview-ui/src/panels/AddCourse.svelte).
 */
export class AddCoursePage {
  public constructor(
    public readonly page: Page,
    public readonly webview: FrameLocator,
  ) {}

  public async expectShown(): Promise<void> {
    await expect(this.webview.getByRole("heading", { level: 1, name: "Add a Course" })).toBeVisible(
      { timeout: 30_000 },
    )
  }

  /** A backend's part of the screen: "courses.mooc.fi" or "tmc.mooc.fi". */
  public section(site: "courses.mooc.fi" | "tmc.mooc.fi"): Locator {
    return this.webview.getByRole("region", { name: site })
  }

  /** The card of the course or organization named `name`. */
  public card(name: string): Locator {
    return this.webview
      .getByRole("listitem")
      .filter({ has: this.webview.getByRole("heading", { level: 3, name, exact: true }) })
  }

  public async search(text: string): Promise<void> {
    await this.webview
      .getByRole("searchbox", { name: "Search courses and organizations" })
      .fill(text)
  }

  /** Adds a courses.mooc.fi course the student is enrolled in. */
  public async addMoocCourse(name: string): Promise<void> {
    await this.section("courses.mooc.fi")
      .getByRole("button", { name: `Add ${name}` })
      .click()
  }

  /** Adds a tmc.mooc.fi course, which is listed under its organization. */
  public async addTmcCourse(organization: string, name: string): Promise<void> {
    const tmc = this.section("tmc.mooc.fi")
    await tmc.getByRole("button", { name: `Show the courses of ${organization}` }).click()
    await tmc.getByRole("button", { name: `Add ${name}` }).click()
  }
}
