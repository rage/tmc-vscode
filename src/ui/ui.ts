import CoursesTree from "./treeview/treeview"

/** The extension's native views. */
export default class UI {
  /** The Courses view in the TestMyCode sidebar. */
  public readonly treeDP: CoursesTree

  /** Creates the views empty; their `viewsWelcome` shows until activation fills them. */
  public constructor() {
    this.treeDP = new CoursesTree()
  }

  public dispose(): void {
    this.treeDP.dispose()
  }
}
