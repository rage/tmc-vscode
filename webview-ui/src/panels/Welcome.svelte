<script lang="ts">
    import { onMount } from "svelte";
    import { WelcomePanel, assertUnreachable } from "../shared/shared";
    import { addMessageListener, loadable, savePanelState } from "../utilities/script";
    import { vscode } from "../utilities/vscode";

    export let panel: WelcomePanel;

    onMount(() => {
        vscode.postMessage({
            type: "requestWelcomeData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "setWelcomeData": {
                panel.version = message.version;
                savePanelState(panel);
                break;
            }
            default:
                assertUnreachable(message.type);
        }
    });
</script>

<div class="container welcome-container">
    <header>
        <h1>Welcome to TestMyCode {panel.version}!</h1>
    </header>

    <div class="info_area">
        <p>
            This extension provides <a href="https://tmc.mooc.fi">TestMyCode</a> integration for Visual
            Studio Code.
        </p>
        <p>
            TestMyCode is a programming assignment evaluator developed and maintained by Agile
            Education Research group (RAGE) at University of Helsinki.
        </p>
        <p>
            To use the TestMyCode environment you need to have an account registered at{" "}
            <a href="https://tmc.mooc.fi">https://tmc.mooc.fi</a>. For setting up the programming
            environment you should always refer to the course specific instructions.
        </p>
        <p>
            Are you new to the TestMyCode extension in VS Code? Please read the instructions on how
            you can complete your first programming exercise by clicking the button below.
        </p>
        <a
            href="https://www.mooc.fi/en/installation/vscode#start-programming"
            class="btn btn-primary"
        >
            Read instructions
        </a>
    </div>

    <div class="content_area">
        <h2>What's new in TestMyCode?</h2>
        <div class="content_section">
            <p>
                Here is a short overview of the latest features. To see the full change history,
                please refer to the{" "}
                <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">
                    CHANGELOG
                </a>
                .
            </p>
        </div>

        <!-- This list should generally contain only the last couple versions/months worth of updates -->

        <div class="content_section">
            <h3>3.4.2 - 2025-08-25</h3>
            <h4>Removed an unnecessary dependency which could cause errors</h4>
            <p>
                The previous version contained a dependency on an unnecessary library which caused
                an error when the library was missing on the user's computer.
            </p>
            <h3>3.4.1 - 2025-08-21</h3>
            <h4>Fixed Python exercises including venv directories when packaging</h4>
            <p>
                Previously, if an exercise contained a venv directory it would get included during
                submissions and cause issues at the server. Now these directories are ignored during
                packaging.
            </p>
            <h3>3.4.0 - 2025-07-17</h3>
            <h4>Improved error handling during initialization</h4>
            <p>
                Previously, any error during initialization would cause the extension menu to not
                load at all. Now, a help screen is displayed and the menu is usable.
            </p>
            <h4>Added a checksum check for langs</h4>
            <p>
                If something goes wrong when downloading langs or it is otherwise corrupted, the
                extension now automatically detects it with a checksum and redownloads langs on
                extension launch.
            </p>
            <h3>3.3.0 - 2025-04-03</h3>
            <h4>Added a command for viewing the output logs</h4>
            <p>
                Added a new command <code>tmc.logs</code> that opens the TestMyCode logs in the Output
                view and a corresponding option in the extension menu.
            </p>
            <h4>Added a command for debugging the extension</h4>
            <p>
                Added a new command <code>tmc.debug</code> that resets the extension logs and opens them
                in a file so users can replicate an issue and easily view the relevant logs.
            </p>
            <h3>3.2.1 - 2025-03-11</h3>
            <h4>Improved error reporting when initialising the extension fails</h4>
            <p>
                Previously certain issues when initialising the extension would only appear in debug
                logging. Now, more information is included in the error message and the logging is
                output at the warn level.
            </p>
            <h3>3.2.0 - 2025-02-25</h3>
            <h4>Test results contain style warnings or errors for applicable exercises</h4>
            <p>
                Exercises can be configured to warn or fail submissions for style e.g. nonstandard
                formatting. These issues are now checked by the extension and the errors caused by
                style issues are displayed.
            </p>
            <h3>3.1.1 - 2025-02-21</h3>
            <h4>Improved error messages and logging</h4>
            <p>
                Various error messages that were previously vague and unhelpful now contain much
                more detail. The associated logging has also been improved to make debugging easier.
            </p>
        </div>
    </div>

    <div class="content_area">
        <h2>Data collected by the extension</h2>
        <div class="content_section">
            <p>
                The extension does not have trackers or telemetry. It’s open source, and anyone can
                verify what it does. See: <a href="https://github.com/rage/tmc-vscode"
                    >https://github.com/rage/tmc-vscode</a
                >.
            </p>
            <p>
                If you choose to submit your answer to a programming exercise to be graded to our
                server, the extension will send us the folder of that specific exercise. This folder
                contains only your solution to the exercise, and no other files are sent. This
                information will also include the language the server should use for error messages.
                The error message language is currently your computer’s locale. We may check the
                answers you submit for plagiarism, and we may use the IP address of the computer
                that submitted the exercise for blocking spam and preventing abuse.
            </p>
            <p>
                The same applies if you choose to submit your answer to the TMC pastebin for sharing
                your solution to other students.
            </p>
            <p>
                When you interact with our server, e.g. log in, download, or submit exercises, we
                will send the version of this plugin in the requests. This is used for blocking
                outdated and potentially misbehaving plugin versions.
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
                    <a href="https://github.com/rage/tmc-vscode/issues"> Questions & Issues </a>
                </li>
                <li>
                    <a href="https://github.com/rage/tmc-vscode/blob/master/docs/FAQ.md"> FAQ </a>
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
                    <a href="https://github.com/rage/tmc-vscode/blob/master/LICENSE"> License </a>
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
