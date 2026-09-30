import { expect } from "@playwright/test"
import type { Locator } from "@playwright/test"

import { MoocLoginPage } from "./mooc-login"
import { QuickPickPage } from "./quick-pick"
import { TmcPage } from "./tmc"

function startingWith(text: string): RegExp {
  return new RegExp(`^${text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")},`)
}

/**
 * The native Courses view in the TestMyCode sidebar, driven by the accessible names its
 * rows carry (`accessibilityInformation` in src/ui/treeview/treeview.ts): a row's name
 * starts with its label and a comma, followed by its status, points and deadline.
 */
export class CoursesViewPage extends TmcPage {
  public async goto(): Promise<void> {
    await this.openMenu()
  }

  public tree(): Locator {
    return this.page.getByRole("tree", { name: "Courses" })
  }

  /** The row of a course, part or exercise whose label is `label`. */
  public row(label: string): Locator {
    return this.tree().getByRole("treeitem", { name: startingWith(label) })
  }

  /** Expands `row` unless it already is; a click on a course or part only toggles it. */
  public async expand(row: Locator): Promise<void> {
    await expect(row).toHaveAttribute("aria-expanded", /true|false/)
    if ((await row.getAttribute("aria-expanded")) === "false") {
      await row.click()
    }
    await expect(row).toHaveAttribute("aria-expanded", "true")
  }

  /** Clicks one of the buttons VS Code shows on `row` while it is hovered. */
  public async runInlineAction(row: Locator, action: string): Promise<void> {
    await row.hover()
    await row.getByRole("button", { name: action, exact: true }).click()
  }

  /** Runs `command` from `row`'s context menu, on the rows selected with it. */
  public async runContextMenuCommand(row: Locator, command: string): Promise<void> {
    await row.click({ button: "right" })
    const item = this.page.locator(".monaco-menu").getByRole("menuitem", { name: command })
    await expect(item).toBeVisible()
    // A synthetic click on a monaco menu item does not activate it; Enter on the
    // hovered item does.
    await item.hover()
    await this.page.keyboard.press("Enter")
    await expect(item).toBeHidden()
  }

  /** Opens the add-course quick pick from the view's title bar. */
  public async openAddCourseQuickPick(): Promise<QuickPickPage> {
    await this.page.getByRole("button", { name: "Add New Course...", exact: true }).click()
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
    await new MoocLoginPage(this.page, this.webview).copyAndOpen()
    await expect(this.notificationToast("Logged in to courses.mooc.fi.")).toBeVisible()
  }
}
