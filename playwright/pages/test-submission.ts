import type { FrameLocator } from "@playwright/test"

import { TmcPage } from "./tmc"

export class TestSubmissionPage extends TmcPage {
  public getWebview(): FrameLocator {
    return this.getSidePanel()
  }
}
