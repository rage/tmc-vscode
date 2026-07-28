import { TmcPage } from "./tmc"

export class SelectPlatform extends TmcPage {
  // Clicking the card's heading bubbles to the surrounding
  // `div.platform[role=button]` handler that fires the selection.
  public async selectTmc(): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: "TestMyCode" }).click()
  }

  public async selectMooc(): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: "Courses MOOC" }).click()
  }
}
