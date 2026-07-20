import TmcMenuTree from "./treeview/treeview"

/**
 * A class for interacting with the user through graphical means
 */
export default class UI {
  /**
   * A TmcTDP object for interacting with the treeview panel
   */
  public treeDP: TmcMenuTree

  /**
   * Creates a UI object with an empty treeview.
   */
  public constructor() {
    this.treeDP = new TmcMenuTree("tmcView")
  }

  /**
   * @return A handler callback for the tmcView.activateEntry command
   */
  public createUiActionHandler(): (onClick: () => void) => void {
    return (onClick: () => void): void => {
      onClick()
    }
  }
}
