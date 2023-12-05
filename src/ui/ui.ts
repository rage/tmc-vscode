import TmcMenuTree from "./treeview/treeview";

/**
 * A class for interacting with the user through graphical means
 */
export default class UI {
    /**
     * A TmcTDP object for interacting with the treeview panel
     */
    public treeDP: TmcMenuTree;

    /**
     * Creates an UI object and (temporarily) initializes it with login-related content
     * @param extensionContext VSCode extension content
     */
    constructor() {
        this.treeDP = new TmcMenuTree("tmcView");
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void): void => {
            onClick();
        };
    }
}
