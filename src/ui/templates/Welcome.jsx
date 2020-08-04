// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

/**
 * @param {import("./Welcome").WelcomeProps} props
 */
function component(props) {
    const { newWorkspace, version } = props;

    return (
        <div class="container">
            <div class="row">
                <div class="col">
                    <h1>Welcome to TestMyCode {version}!</h1>
                    <p>
                        Here is a little overview of latest features. Click HERE to see the full
                        changelog.
                    </p>
                </div>
            </div>
            <div class="row">
                <div class="col-9">
                    <p class="h4">New exercise workspaces</p>
                    <p>
                        Exercise workspace has been completely reworked to take a full advantage of
                        VSCode's <span />
                        <a href="https://code.visualstudio.com/docs/editor/multi-root-workspaces">
                            Multi-root Workspaces
                        </a>
                        .
                    </p>
                    <p>There are some caveats it the current version of VSCode</p>
                    <strong>Highlighed in the image:</strong>
                    <ul>
                        <li>
                            Changing the top folder in Multi-root Workspace will cause VSCode to
                            restart. <code>.tmc</code> folder is forced on top as a workaround.
                        </li>
                        <li>
                            The file <code>TMC-Readme.md</code> exists to allow this extension to
                            start when opening an exercise workspace.
                        </li>
                    </ul>
                </div>
                <div class="col-3">
                    <img src={newWorkspace} />
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <div class="row">
                        <div class="col-1">
                            <div class="custom-control custom-switch">
                                <input
                                    type="checkbox"
                                    class="custom-control-input"
                                    id="insider-status"
                                    disabled
                                />
                                <label class="custom-control-label" for="insider-status">
                                    Enable
                                </label>
                            </div>
                        </div>
                        <div class="col-11">
                            <p class="h3">Insider features</p>
                            <p>
                                These features are in preview and can be enabled by turning the
                                insider mode on. Please be aware that they may cause issues or
                                instability. You can always opt in or out from these features at the
                                extension's settings page.
                            </p>
                            <h4>Java replacement</h4>
                            <p>
                                The extension uses a middleware called TMC-langs to handle some of
                                its features. As TMC-langs was written in Java, it caused an
                                external dependency for this extension. A Rust replacement was
                                already featured silently in version 0.9.0 for the purpose of
                                running tests for some users. This feature is now enabled for all
                                users, while the new insider version no longer uses Java at all.
                            </p>
                            <h4>External TMC API requests</h4>
                            <p>
                                In addition to replacing the Java implementation, new TMC-langs
                                provides a standard by which to communicate with TMC API. Almost all
                                requests to TMC server are now handled by the new TMC-langs for
                                insiders.
                            </p>
                            <h4>Passing Python executable to TMC-langs</h4>
                            <p>
                                For a while there has been an issue where the Python version used
                                when testing exercises may have been different from the one used
                                with normal execution. This happened because the Python extension
                                allows changing between several detected Python versions on system,
                                but the same information wasn't available to TMC-langs. The insider
                                version is now able to pass this information to the new Langs as a
                                possible fix.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * @param {import("./Welcome").WelcomeProps} props
 */
function render(props) {
    return component(props).toString();
}

function script() {
    const vscode = acquireVsCodeApi();
    const insiderToggle = document.getElementById("insider-status");

    window.addEventListener("message", (event) => {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
            switch (message.command) {
                case "setInsiderStatus":
                    insiderToggle.checked = message.enabled;
                    insiderToggle.disabled = false;
                    insiderToggle.addEventListener(
                        "click",
                        (event) => {
                            insiderToggle.disabled = true;
                            vscode.postMessage({
                                type: "insiderStatus",
                                data: event.target.checked,
                            });
                        },
                        { once: true },
                    );
                    break;
            }
        }
    });
}

export { component, render, script };
