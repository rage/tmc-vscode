import { expect, test } from "@playwright/test"
import type { Locator } from "@playwright/test"

import { AddCoursePage } from "./add-course"
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

  /**
   * Expands `row` unless it already is. A click on a part toggles it; on a course it opens the
   * course's Course Details and expands the row.
   */
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
    await this.dismissHover()
  }

  /**
   * Moves the pointer off a just-clicked button: its hover tooltip outlives the click and
   * swallows clicks on the rows below it.
   */
  private async dismissHover(): Promise<void> {
    await this.page.mouse.move(0, 0)
    await expect(this.page.locator(".context-view:visible")).toHaveCount(0)
  }

  /** Opens the workspace of the course labelled `course`, which reloads the window. */
  public async openCourseWorkspace(course: string): Promise<void> {
    await this.reloadingWindow(() =>
      this.runInlineAction(this.row(course), "Open Course Workspace"),
    )
    // The course home opens once the extension starts there, covering any file opened before.
    await this.panelHeaded(course)
  }

  /** Runs `command` from `row`'s context menu, on the rows selected with it. */
  public async runContextMenuCommand(row: Locator, command: string): Promise<void> {
    // oxlint-disable-next-line playwright/no-skipped-test -- skips whichever test needs the menu
    test.skip(process.platform === "darwin", "macOS shows context menus natively, outside the page")
    const item = this.page
      .locator(".monaco-menu")
      .getByRole("menuitem", { name: command, exact: true })
    // A right-click landing while the row's hover tooltip opens is sometimes swallowed.
    await expect(async () => {
      await row.click({ button: "right" })
      await expect(item).toBeVisible({ timeout: 2_000 })
    }).toPass()
    // A synthetic click on a monaco menu item does not activate it; Enter on the
    // hovered item does.
    await item.hover()
    await this.page.keyboard.press("Enter")
    await expect(item).toBeHidden()
  }

  /** Opens the add-course screen from the view's title bar. */
  public async openAddCourse(): Promise<AddCoursePage> {
    await this.page
      .getByRole("toolbar", { name: "TestMyCode: Courses actions" })
      .getByRole("button", { name: "Add Course", exact: true })
      .click()
    await this.dismissHover()
    // By heading: a panel revealed again keeps its place, behind webviews opened since.
    return new AddCoursePage(this.page, await this.panelHeaded("Add Course"))
  }

  /** Adds a tmc.mooc.fi course, which is picked inside its organization, and waits for its home. */
  public async addNewCourse(name: string): Promise<void> {
    const addCourse = await this.openAddCourse()
    await addCourse.addTmcCourse("Test Organization", name)
    await this.panelHeaded(name)
  }

  /**
   * Adds a courses.mooc.fi course and waits for its home. Enrolled courses are only listed once
   * that backend has a session, so this logs in first.
   */
  public async addNewMoocCourse(name: string): Promise<void> {
    const addCourse = await this.logInToMooc()
    await addCourse.addMoocCourse(name)
    await this.panelHeaded(name)
  }

  /** Logs in from the add-course screen, which offers it while courses.mooc.fi has no session. */
  public async startMoocLogin(): Promise<AddCoursePage> {
    const addCourse = await this.openAddCourse()
    // Above the listings when logged out, in the courses.mooc.fi section with a tmc.mooc.fi login.
    await this.webview.getByRole("button", { name: "Log In", exact: true }).click()
    return addCourse
  }

  /**
   * Runs the device flow to completion against the mock's auto-approving client, which leaves
   * the add-course screen showing the enrolled courses.
   */
  public async logInToMooc(): Promise<AddCoursePage> {
    const addCourse = await this.startMoocLogin()
    await expect(this.statusBarMessage("Logged in.")).toBeVisible()
    await addCourse.expectShown()
    return addCourse
  }
}
