import { TmcPage } from "./tmc"

export class SelectOrganization extends TmcPage {
  public async select(org: string): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: org }).click()
  }
}
