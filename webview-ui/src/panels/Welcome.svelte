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
            <h3>3.0.4</h3>
            <h4>.csproj files are no longer included when submitting C# exercises</h4>
            <p>
                Previously, it was possible to modify and submit .csproj files which would cause
                errors during testing on the server.
            </p>
            <p>
                As the dependencies of the extension were updated, the minimum supported VSCode
                version was also updated to a more recent version. 1.86.0 was released in released
                in January 2024.
            </p>
            <h4>Fixed the TMC-langs CLI's permissions being set to 111</h4>
            <p>
                Previously, the CLI binary used by the extension had its permissions set to 111
                (-rw-rw-rw) when it was downloaded. From now, the permissions are set to 755.
            </p>
        </div>
        <div class="content_section">
            <h3>3.0.3</h3>
            <h4>Fixed missing "Send solution to server" button when tests are ran successfully</h4>
            <p>This button existed in the old UI but was accidentally omitted from the new one.</p>
            <h4>Fixed running tests for exam exercises not working correctly</h4>
            <p>
                Previously, trying to run tests for an exam exercise would show an endless loading
                spinner.
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
