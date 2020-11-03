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
    const { version, newTreeView, actionsExplorer } = props;

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
                <h2>What's new in 1.3?</h2>
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
                    <h3>Improved caching for API data</h3>
                    <p>
                        The caching system for TMC API data has been reworked. Previous version
                        didn't invalidate data over time, so it had limited use potential. Most
                        responses will now be re-used for up to five minutes, after which they will
                        be re-fetched.
                    </p>
                </div>
                <div class="content_section">
                    <h3>Arm64 build of TMC-langs for Mac OS</h3>
                    <p>
                        New native build of TMC-langs is now provided for MAC OS 11 users with ARM
                        architecture.
                    </p>
                </div>
                <h2 style="py-2">Previous releases</h2>
                <div class="content_section">
                    <h3>Automatic exercise updates</h3>
                    <p>
                        When there are updates available to exercises, the extension will now
                        download them automatically for you. This allows fixes and improvements for
                        exercises to to reach users more consistently. The old behavior can be
                        toggled back from the settings.
                    </p>
                </div>
                <div class="content_section">
                    <h3>Alternative way to run tests for Jupyter Notebooks</h3>
                    <p>
                        In VSCode Explorer view, we've added the possibility to run exercise related
                        actions by right clicking on exercise files or folders. This allows to run
                        tests for exercises that don't have the TMC icons displayed at the top
                        right.
                    </p>
                    <img
                        style="margin-bottom: 1em;"
                        class="rounded mx-auto d-block"
                        src={actionsExplorer}
                    />
                </div>
                <div class="content_section">
                    <h3>New TMC Tree view</h3>
                    <p>
                        You can now see your courses listed in the TMC Tree view under My Courses.
                        We've added actions in this view so you are able to Add, Remove and Refresh
                        courses. You can add and refresh courses from buttons marked in the red
                        rectangle. When you refresh courses it will check for new updates and
                        exercises for all courses.
                    </p>
                    <img
                        style="margin-bottom: 1em;"
                        class="rounded mx-auto d-block"
                        src={newTreeView}
                    />
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
