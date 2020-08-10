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
    const { newWorkspace, version, openNewWorkspace } = props;

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
                    If you are new to the TestMyCode extension in VSCode. Please read the
                    instructions on how you can complete your first programming exercise by clicking
                    the button below.
                </p>
                <a
                    href="https://www.mooc.fi/en/installation/vscode#ohjelmoinnin-aloittaminen"
                    class="btn btn-primary"
                >
                    Read instructions
                </a>
            </div>

            <div class="content_area">
                <h2>What's new?</h2>
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

                <h3>New exercise workspaces</h3>
                <div class="content_section">
                    <div class="row">
                        <div class="col-md">
                            <p>
                                Exercise workspace has been completely reworked to take a full
                                advantage of VSCode's{" "}
                                <a href="https://code.visualstudio.com/docs/editor/multi-root-workspaces">
                                    Multi-root Workspaces
                                </a>
                                .
                            </p>
                            <p>
                                Our workspace refactor introduces course specific workspaces which
                                fixes various issues that we have encountered since launch.
                                Implementation of Multi-root Workspace for courses enables the
                                following:
                                <ul>
                                    <li>
                                        Debugging individual exercises (i.e. adding
                                        .vscode/launch.json to exercise folder)
                                    </li>
                                    <li>
                                        Course specific settings and extension recommendations in
                                        VSCode
                                    </li>
                                    <li>
                                        Fixes issue with file handling when communicating using
                                        TMC-langs and other VSCode extensions
                                    </li>
                                </ul>
                            </p>
                            <p>You can open a course workspace via "My courses" view.</p>
                            <img style="margin-bottom: 2.5em;" src={openNewWorkspace} />
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md">
                            <strong>There are some caveats in VSCode:</strong>
                            <ul>
                                <li>
                                    Changing the top folder in Multi-root Workspace will cause
                                    VSCode to restart. <code>.tmc</code> folder is forced on top as
                                    a workaround.
                                </li>
                                <li>
                                    The file <code>TMC-Readme.md</code> exists to allow this
                                    extension to start when opening an exercise workspace.
                                </li>
                            </ul>
                        </div>
                        <div class="col-md-3">
                            <img src={newWorkspace} />
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-md-10">
                        <h3>Insider features</h3>
                    </div>
                    <div class="col-md-2">
                        <div class="custom-control custom-switch">
                            <input
                                type="checkbox"
                                class="custom-control-input"
                                id="insider-status"
                                disabled
                            />
                            <label class="custom-control-label" for="insider-status">
                                Enabled
                            </label>
                        </div>
                    </div>
                </div>
                <div class="content_section">
                    <p>
                        These features are in preview and can be enabled by turning the insider mode
                        on. Please be aware that they may cause issues or instability. You can
                        always opt in or out from these features at the extension's settings page.
                    </p>
                    <h4>Java replacement</h4>
                    <p>
                        The extension uses a middleware called TMC-langs to handle many of its
                        features. As TMC-langs was written in Java, it caused an external dependency
                        for this extension. A Rust replacement was already featured silently in
                        version 0.9.0 for the purpose of running tests for some users. This feature
                        is now enabled for all users, while the new insider version no longer uses
                        Java at all.
                    </p>
                    <h4>External TMC API requests</h4>
                    <p>
                        In addition to replacing the Java implementation, new TMC-langs provides a
                        standard by which to communicate with TMC API. Almost all requests to TMC
                        server are now handled by the new TMC-langs for insiders.
                    </p>
                    <h4>Passing Python executable to TMC-langs</h4>
                    <p>
                        For a while there has been an issue where the Python version used when
                        testing exercises may have been different from the one used with normal
                        execution. This happened because the Python extension allows changing
                        between several detected Python versions on system, but the same information
                        wasn't available to TMC-langs. The insider version is now able to pass this
                        information to the new Langs as a possible fix.
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
                            <a href="https://www.mooc.fi/en/installation/vscode#ohjelmoinnin-aloittaminen">
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

function script() {
    const vscode = acquireVsCodeApi();
    const insiderToggle = document.getElementById("insider-status");
    const insiderToggleLabel = document.getElementsByClassName("custom-control-label");

    window.addEventListener("message", (event) => {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
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
}

export { component, render, script };
