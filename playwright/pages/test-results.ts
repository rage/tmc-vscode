import type { FrameLocator } from "@playwright/test"

import { TmcPage } from "./tmc"

export class TestResultsPage extends TmcPage {
  public async submit(): Promise<void> {
    await this.getWebview().getByRole("button", { name: "Send solution to server" }).first().click()
  }

  public getWebview(): FrameLocator {
    return this.getSidePanel()
  }
}
