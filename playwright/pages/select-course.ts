import { TmcPage } from "./tmc"

export class SelectCourse extends TmcPage {
  public async select(course: string): Promise<void> {
    await this.getSidePanel().getByRole("heading", { name: course }).click()
  }
}
