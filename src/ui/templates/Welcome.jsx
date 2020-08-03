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
    const { version } = props;

    return (
        <div class="container">
            <div class="row">
                <div class="col">
                    <h1>Welcome to TMC-VSCode version {version}!</h1>

                    <p>Here is an overview of new features.</p>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <h3>New exercise workspace</h3>
                    <div class="row">
                        <div class="col-8">Description here</div>
                        <div class="col-4">image here</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <h2>Insider features</h2>
                    <p>
                        Upcoming features that can already be enabled for trying them out. May
                        contain bux.
                    </p>
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
