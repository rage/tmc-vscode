import { TmcPage } from "./tmc"

export class CoursePage extends TmcPage {
  public async openWorkspace(): Promise<void> {
    await this.webview.getByRole("button", { name: "Open workspace" }).first().click()
  }

  // Setting <vscode-collapsible>'s `open` property directly is more reliable
  // than clicking the toggle it renders in its shadow DOM.
  public async showExercises(): Promise<void> {
    const groups = this.getSidePanel().locator("vscode-collapsible")
    const count = await groups.count()
    for (let i = 0; i < count; i++) {
      await groups.nth(i).evaluate((el) => {
        ;(el as unknown as { open: boolean }).open = true
      })
    }
  }

  public async openExercises(names: string[]): Promise<void> {
    for (const name of names) {
      await this.getSidePanel().locator(`vscode-checkbox[aria-label="${name}"]`).click()
    }
    await this.getSidePanel().getByRole("button", { name: "Open", exact: true }).first().click()
  }
}
