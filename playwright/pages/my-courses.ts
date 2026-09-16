import { expect } from "@playwright/test"

import { QuickPickPage } from "./quick-pick"
import { TmcPage } from "./tmc"

export class MyCoursesPage extends TmcPage {
  public async goto(): Promise<void> {
    await this.openMenu()
    await this.page.getByRole("treeitem", { name: "My Courses" }).locator("a").click()
  }

  /** Opens the add-course quick pick from the My Courses button. */
  public async openAddCourseQuickPick(): Promise<QuickPickPage> {
    await this.webview.getByRole("button", { name: "Add new course" }).first().click()
    const quickPick = new QuickPickPage(this.page)
    await quickPick.waitForTitle("Add New Course")
    return quickPick
  }

  /** Adds a TMC Server course, which is picked inside its organization. */
  public async addNewCourse(name: string): Promise<void> {
    const quickPick = await this.openAddCourseQuickPick()
    await quickPick.selectByLabel("Test Organization")
    await quickPick.selectByLabel(name)
    await quickPick.expectClosed()
  }

  /**
   * Adds a courses.mooc.fi course. Enrolled courses are only listed once that
   * backend has a session, so this logs in first.
   */
  public async addNewMoocCourse(name: string): Promise<void> {
    await this.logInToMooc()
    const quickPick = await this.openAddCourseQuickPick()
    await quickPick.selectByLabel(name)
    await quickPick.expectClosed()
  }

  /** Picks the login entry the quick pick offers while courses.mooc.fi has no session. */
  public async startMoocLogin(): Promise<void> {
    const quickPick = await this.openAddCourseQuickPick()
    await quickPick.selectByLabel("Log in to courses.mooc.fi")
  }

  /** Runs the device flow to completion against the mock's auto-approving client. */
  public async logInToMooc(): Promise<void> {
    await this.startMoocLogin()
    await expect(this.notificationToast("Logged in to courses.mooc.fi.")).toBeVisible()
  }

  public async selectCourse(name: string): Promise<void> {
    // The webview fixture resolves to the last ready frame, which is a side panel
    // while one is closing; waiting for a My Courses control pins it to the right one.
    await this.webview.getByRole("button", { name: "Add new course" }).first().waitFor()
    await this.webview.getByRole("heading", { name }).first().click()
  }
}
