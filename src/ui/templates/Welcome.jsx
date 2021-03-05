// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

// Provided by VSCode vebview at runtime
// eslint-disable-next-line @typescript-eslint/no-unused-vars
/*global acquireVsCodeApi*/

/**
 * @param {import("./Welcome").WelcomeProps} props
 */
function component({ version }) {
    return (
        <div class="container welcome-container">
            <header>
                <h1>Welcome to TestMyCode {version}!</h1>
            </header>

            <div class="info_area">
                <p>
                    This extension provides <a href="https://tmc.mooc.fi">TestMyCode</a> integration
                    for Visual Studio Code.
                </p>
                <p>
                    TestMyCode is a programming assignment evaluator developed and maintained by
                    Agile Education Research group (RAGE) at University of Helsinki.
                </p>
                <p>
                    To use the TestMyCode environment you need to have an account registered at{" "}
                    <a href="https://tmc.mooc.fi">https://tmc.mooc.fi</a>. For setting up the
                    programming environment you should always refer to the course specific
                    instructions.
                </p>
                <p>
                    Are you new to the TestMyCode extension in VS Code? Please read the instructions
                    on how you can complete your first programming exercise by clicking the button
                    below.
                </p>
                <a
                    href="https://www.mooc.fi/en/installation/vscode#start-programming"
                    class="btn btn-primary"
                >
                    Read instructions
                </a>
            </div>

            <div class="content_area">
                <h2>What's new in 2.0?</h2>
                <div class="content_section">
                    <p>
                        Here is a little overview of latest features. To see all the changes for
                        version {version}, please refer to the{" "}
                        <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">
                            CHANGELOG
                        </a>
                        .
                    </p>
                </div>
                <div class="content_section">
                    <h5>
                        Caution! It is not recommended to downgrade the extension version to below
                        2.0!
                    </h5>
                </div>
                <div class="content_section">
                    <h3>Exercise management</h3>
                    <p>
                        The main focus of this release is to introduce a new management system for
                        exercises on disk. These features have been moved to TMC-Langs that is the
                        centralized utility for main TestMyCode related functions. This new
                        architecture reduces previously existing major overheads and allows for some
                        performance optimizations.
                    </p>
                    <p>
                        Unfortunately this change required for all exercises to be migrated to a
                        new default location. If you would like to, you may now move them back again
                        from the settings view.
                    </p>
                </div>
                <div class="content_section">
                    <h3>Improved exercise downloads</h3>
                    <p>
                        Following the change to exercise management, downloading new exercises is
                        now significantly faster.
                    </p>
                </div>
                <div class="content_section">
                    <h3>Improvements to TMC workspace</h3>
                    <p>
                        TMC Workspace files have now been located in a consistent location separate
                        from where exercises are. This allows for more user-friendly experience when
                        moving the exercises folder or using the extension data wipe command.
                    </p>
                </div>
            </div>

            <div class="sidebar">
                <div class="sidebar_group">
                    <h4>Help</h4>
                    <ul>
                        <li>
                            <a href="https://www.mooc.fi/en/installation/vscode">
                                Installing environment
                            </a>
                        </li>
                        <li>
                            <a href="https://www.mooc.fi/en/installation/vscode#start-programming">
                                Start programming
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/issues">
                                Questions & Issues
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/blob/master/docs/FAQ.md">
                                FAQ
                            </a>
                        </li>
                    </ul>
                </div>
                <div class="sidebar_group">
                    <h4>Resources</h4>
                    <ul>
                        <li>
                            <a href="https://www.helsinki.fi/en/researchgroups/data-driven-education">
                                Website
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">
                                Changelog
                            </a>
                        </li>
                        <li>
                            <a href="https://marketplace.visualstudio.com/publishers/moocfi">
                                Marketplace
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode">GitHub</a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/blob/master/docs/insider.md">
                                Insiders
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/blob/master/LICENSE">
                                License
                            </a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-vscode/blob/master/CONTRIBUTING.md">
                                Contributing
                            </a>
                        </li>
                    </ul>
                </div>
                <div class="sidebar_group">
                    <h4>TestMyCode Resources</h4>
                    <ul>
                        <li>
                            <a href="http://mooc.fi/">mooc.fi</a>
                        </li>
                        <li>
                            <a href="https://tmc.mooc.fi">tmc.mooc.fi</a>
                        </li>
                        <li>
                            <a href="https://github.com/rage/tmc-langs-rust">TMC-langs Rust</a>
                        </li>
                    </ul>
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

/* function script() {
    const vscode = acquireVsCodeApi();
    const insiderToggle = document.getElementById("insider-status");
    const insiderToggleLabel = document.getElementsByClassName("custom-control-label");

    window.addEventListener("message", (event) => {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
/* const message = event.data[i];
            switch (message.command) {
                case "setInsiderStatus":
                    insiderToggleLabel[0].innerHTML = "Enabled";
                    if (!message.enabled) {
                        insiderToggleLabel[0].innerHTML = "Disabled";
                    }
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
} */

export { component, render };
