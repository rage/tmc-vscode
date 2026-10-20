import { expect } from "@playwright/test"
import type { FrameLocator, Locator, Page } from "@playwright/test"

/**
 * Course Details, the course home in the main panel, driven by its accessible names
 * (webview-ui/src/panels/CourseDetails.svelte).
 *
 * `webview` is the fixture's frame: the TestMyCode webview shown last, which is the course home
 * as long as no submission result has opened beside it since.
 */
export class CourseHomePage {
  public constructor(
    public readonly page: Page,
    public readonly webview: FrameLocator,
  ) {}

  public heading(courseTitle: string): Locator {
    return this.webview.getByRole("heading", { level: 1, name: courseTitle })
  }

  public async expectShown(courseTitle: string): Promise<void> {
    await expect(this.heading(courseTitle)).toBeVisible({ timeout: 30_000 })
  }

  /** Brings Course Details back from behind another editor through its tab. */
  public async reveal(courseTitle: string): Promise<void> {
    await this.page.getByRole("tab", { name: new RegExp(`^${courseTitle}`) }).click()
    await this.expectShown(courseTitle)
  }

  /** The row of the exercise named `name`. */
  public row(name: string): Locator {
    return this.webview
      .getByRole("listitem")
      .filter({ has: this.webview.getByRole("button", { name, exact: true }) })
  }

  /** The course's notices: new exercises, updates, Restricted Mode and the like. */
  public notices(): Locator {
    return this.webview.getByRole("list", { name: "Course notices" })
  }

  /** Clicks the course's Download button, which names how many exercises it downloads. */
  public async downloadAll(): Promise<void> {
    await this.webview.getByRole("button", { name: /^Download \d+ Exercises?$/ }).click()
  }

  public async openCourseWorkspace(): Promise<void> {
    await this.webview.getByRole("button", { name: "Open Course Workspace" }).click()
  }

  /** Opens the exercise from its row, as a click on its name does. */
  public async openExercise(name: string): Promise<void> {
    await this.webview.getByRole("button", { name, exact: true }).click()
  }

  /** Waits for the exercise's row to say it is `state`, e.g. "Open" or "Not downloaded". */
  public async expectState(name: string, state: string): Promise<void> {
    await expect(this.row(name)).toContainText(state, { timeout: 30_000 })
  }
}
