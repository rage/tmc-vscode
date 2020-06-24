import Resources from "../config/resources";
import TemporaryWebview from "./temporaryWebview";
import UI from "./ui";

/**
 * A helper class for an easy access to a recycled pool of Temporary Webviews.
 */
export default class TemporaryWebviewProvider {
    private temporaryWebviewPool: TemporaryWebview[];
    private createNewWebview: () => TemporaryWebview;

    /**
     * Creates a new instance of TemporaryWebviewProvider.
     * @param resources A resources instance that is passed to temporary webview constructors.
     * @param ui A ui instance that is passed to temporary webview constructors.
     */
    constructor(resources: Resources, ui: UI) {
        this.temporaryWebviewPool = [];
        this.createNewWebview = (): TemporaryWebview => new TemporaryWebview(resources, ui);
    }

    /**
     * Returns a temporary webview that was previously passed to this object with addToRecycables.
     * Attempts to use a webview that is already visible to the user.
     * If no suitable webviews exists, creates a new one.
     */
    public getTemporaryWebview(): TemporaryWebview {
        let visible: TemporaryWebview | undefined;
        this.temporaryWebviewPool = this.temporaryWebviewPool.filter((tw) => !tw.disposed);
        const visibleIndex = this.temporaryWebviewPool.findIndex((tw) => tw.isVisible());
        if (visibleIndex >= 0) {
            visible = this.temporaryWebviewPool[visibleIndex];
            this.temporaryWebviewPool = this.temporaryWebviewPool.filter(
                (tw, i) => i !== visibleIndex,
            );
        }
        return visible || this.temporaryWebviewPool.pop() || this.createNewWebview();
    }

    /**
     * Adds the given TemporaryWebview to the pool of recycables, allowing it to be recycled.
     * Webviews passed to this function should no longer be used for anything specific.
     */
    public addToRecycables(temporaryWebview: TemporaryWebview): void {
        if (!temporaryWebview.disposed) {
            this.temporaryWebviewPool.push(temporaryWebview);
        }
    }
}
