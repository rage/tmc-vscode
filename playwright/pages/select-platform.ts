import { TmcPage } from "./tmc"

export class SelectPlatform extends TmcPage {
  public async selectTmc(): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: "https://tmc.mooc.fi" }).click()
  }

  public async selectMooc(): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: "https://courses.mooc.fi" }).click()
  }
}
