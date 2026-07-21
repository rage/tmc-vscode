import { TmcPage } from "./tmc"

export class SelectMoocCourse extends TmcPage {
  public async select(course: string): Promise<void> {
    // Each enrolled course renders as an `<h3>{name} <small>({slug})</small></h3>`
    // inside a clickable row; the (substring) heading match finds it by name.
    await this.getSidePanel().getByRole("heading", { name: course }).first().click()
  }
}
