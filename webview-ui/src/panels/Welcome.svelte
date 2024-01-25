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
        <h2>What's new in 3.0.0?</h2>
        <div class="content_section">
            <p>
                Here is a short overview of latest features. To see all the changes for version {panel.version},
                please refer to the{" "}
                <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">
                    CHANGELOG
                </a>
                .
            </p>
        </div>
        <div class="content_section">
            <h3>New user interface</h3>
            <p>
                The extension's appearance has been updated. The extension's functionality remains
                the same, with only minor changes to the user experience.
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
