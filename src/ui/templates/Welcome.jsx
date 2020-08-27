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
function component(props) {
    const { newWorkspace, version, openNewWorkspace, newTMCMenu, TMCMenuIcon } = props;

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
                <h3>
                    TMC Commands Menu <img src={TMCMenuIcon} />
                </h3>
                <div class="content_section">
                    <p>
                        All TMC related commands can now be found in the TMC Commands Menu{" "}
                        <img src={TMCMenuIcon} /> (hotkey: CTRL + SHIFT + A) when logged in. This
                        means that you can, for example, switch course workspace or download updates
                        and new exercise for courses easily.
                    </p>
                    <img
                        style="margin-bottom: 2.5em;"
                        class="rounded mx-auto d-block"
                        src={newTMCMenu}
                    />
                </div>

                <h3>Removed Java Dependency</h3>
                <div class="content_section">
                    <p>
                        The extension uses a middleware called TMC-langs to handle many of its
                        features. As the old version of TMC-langs was written in Java, it caused an
                        external dependency for this extension. A Rust replacement for TMC-langs was
                        featured for Insider users since version 0.9.0 to handle some of the TMC
                        related actions. Since version 1.0.0 TMC-langs Rust handles all TMC related
                        commands and API requests, so Java dependency under the hood is removed. If
                        the extension has downloaded Java, it will be removed from the tmcdata
                        folder, aswell all the old TMC-langs jar files.
                    </p>
                </div>

                <h3>Python Interpreter</h3>
                <div class="content_section">
                    <h5>Passing VSCode Python Interpreter to TMC-langs</h5>
                    <p>
                        For a while there has been an issue where the Python Interpreter used when
                        testing exercises may have been different from the one used with normal
                        execution. This happened because the VSCode Python extension allows changing
                        between several detected Python versions on system, but the same information
                        wasn't available to TMC-langs. In version 1.0.0 the Python Executable path
                        is passed to TMC-langs.
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
                            <p>You can open a course workspace via "My Courses" view.</p>
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
