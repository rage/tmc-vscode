import { TmcPage } from "./tmc"

export class CoursePage extends TmcPage {
  public async openWorkspace(): Promise<void> {
    await this.webview.getByRole("button", { name: "Open workspace" }).first().click()
    const yesButton = this.page.getByRole("button", { name: "Yes" }).first()
    try {
      // click yes if prompted
      await yesButton.waitFor({ timeout: 1000 })
      yesButton.click()
    } catch (_e) {
      // no-op
    }
  }

  public async showExercises(): Promise<void> {
    await this.webview.getByRole("button", { name: "Show exercises" }).first().click()
  }

  public async openExercises(names: string[]): Promise<void> {
    for (const name of names) {
      // The checkbox's actual click target is the wrapping `role="button"`
      // span in `Checkbox.svelte` — the `<input type="checkbox">` itself is
      // covered by its `<label>`, so `role="checkbox"` fails Playwright's
      // actionability check.
      await this.webview.getByRole("row", { name }).getByRole("button").click()
    }
    await this.webview.getByRole("button", { name: "Open", exact: true }).first().click()
  }
}
