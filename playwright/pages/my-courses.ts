import { SelectCourse } from "./select-course"
import { SelectMoocCourse } from "./select-mooc-course"
import { SelectOrganization } from "./select-organization"
import { SelectPlatform } from "./select-platform"
import { TmcPage } from "./tmc"

export class MyCoursesPage extends TmcPage {
  public async goto(): Promise<void> {
    await this.openMenu()
    await this.page.getByRole("treeitem", { name: "My Courses" }).locator("a").click()
  }

  public async addNewCourse(name: string): Promise<void> {
    await this.webview.getByRole("button", { name: "Add new course" }).first().click()

    // Adding a course goes through platform selection first; these specs
    // exercise the tmc flow against the mock backend.
    const selectPlatform = new SelectPlatform(this.page, this.webview)
    await selectPlatform.selectTmc()

    const selectOrganization = new SelectOrganization(this.page, this.webview)
    await selectOrganization.select("Test Organization (test)")
    // wait for the organization selection page to close
    // oxlint-disable-next-line playwright/no-wait-for-timeout -- deliberate settle-delay while polling flaky VS Code webview UI
    await this.page.waitForTimeout(200)

    const selectCourse = new SelectCourse(this.page, this.webview)
    await selectCourse.select(name)
  }

  public async addNewMoocCourse(name: string): Promise<void> {
    await this.webview.getByRole("button", { name: "Add new course" }).first().click()

    // Adding a course goes through platform selection first; here we pick the
    // mooc (courses.mooc.fi) platform, then a course from the enrolled list the
    // mooc mock backend serves.
    const selectPlatform = new SelectPlatform(this.page, this.webview)
    await selectPlatform.selectMooc()

    const selectMoocCourse = new SelectMoocCourse(this.page, this.webview)
    await selectMoocCourse.select(name)
  }

  public async selectCourse(name: string): Promise<void> {
    await this.webview.getByRole("heading", { name }).click()
  }
}
