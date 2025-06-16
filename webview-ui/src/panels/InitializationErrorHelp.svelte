<script lang="ts">
    import { onMount } from "svelte";
    import { assertUnreachable, InitializationErrorHelpPanel } from "../shared/shared";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener, loadable } from "../utilities/script";

    export let panel: InitializationErrorHelpPanel;

    const cliFolder = loadable<string | null>();
    const tmcError = loadable<string | null>();
    const userDataError = loadable<string | null>();
    const workspaceManagerError = loadable<string | null>();
    const exerciseDecorationProviderError = loadable<string | null>();
    const resourcesError = loadable<string | null>();

    onMount(() => {
        vscode.postMessage({
            type: "requestInitializationErrors",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "initializationErrors": {
                cliFolder.set(message.cliFolder);
                tmcError.set(message.initializationErrors.tmc);
                userDataError.set(message.initializationErrors.userData);
                workspaceManagerError.set(message.initializationErrors.workspaceManager);
                exerciseDecorationProviderError.set(
                    message.initializationErrors.exerciseDecorationProvider,
                );
                resourcesError.set(message.initializationErrors.resources);
                break;
            }
            default:
                assertUnreachable(message.type);
        }
    });
</script>

<h1>Initializing the extension failed</h1>
<div>Something went wrong while initializing the extension.</div>
<ul>
    {#if $tmcError}
        <li>
            <div>Failed to initialize tmc-langs: {$tmcError}.</div>
            <div>
                This error may be caused by a proxy or firewall that is blocking network requests or
                by an antivirus program. This may also be caused by an antivirus program. You can
                try to resolve this issue by adding an exception to the directory at '{$cliFolder}'.
            </div>
        </li>
    {/if}
    {#if $userDataError}
        <li>Failed to initialize userdata: {$userDataError}.</li>
    {/if}
    {#if $workspaceManagerError}
        <li>Failed to initialize workspace manager: {$workspaceManagerError}.</li>
    {/if}
    {#if $exerciseDecorationProviderError}
        <li>
            Failed to initialize exercise decoration provider: {$exerciseDecorationProviderError}.
        </li>
    {/if}
    {#if $resourcesError}
        <li>Failed to initialize resources: {$resourcesError}.</li>
    {/if}
</ul>
<div>
    You can try to reinitialize the extension by pressing "Restart extension host" in the extension
    menu.
</div>
<div>
    You can also look at the logs by pressing "Open TMC Extension Logs" in the menu for more
    information about what went wrong. You can increase the log level the Settings to `verbose` to
    see more log messages.
</div>
<div>
    If you cannot solve this issue, please create an issue at
    <a href="https://github.com/rage/tmc-vscode">https://github.com/rage/tmc-vscode</a>.
</div>
