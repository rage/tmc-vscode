<script lang="ts">
    import { onMount } from "svelte";
    import { assertUnreachable, InitializationErrorHelpPanel } from "../shared/shared";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener, loadable } from "../utilities/script";

    export let panel: InitializationErrorHelpPanel;

    type ErrorData = {
        cliFolder: string;
        tmcError: { error: string; stack: string } | null;
        userDataError: { error: string; stack: string } | null;
        workspaceManagerError: { error: string; stack: string } | null;
        exerciseDecorationProviderError: { error: string; stack: string } | null;
        resourcesError: { error: string; stack: string } | null;
    };
    const errorData = loadable<ErrorData>();

    onMount(() => {
        vscode.postMessage({
            type: "requestInitializationErrors",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "initializationErrors": {
                errorData.set({
                    cliFolder: message.cliFolder,
                    tmcError: message.initializationErrors.tmc,
                    userDataError: message.initializationErrors.userData,
                    workspaceManagerError: message.initializationErrors.workspaceManager,
                    exerciseDecorationProviderError:
                        message.initializationErrors.exerciseDecorationProvider,
                    resourcesError: message.initializationErrors.resources,
                });
                break;
            }
            default:
                assertUnreachable(message.type);
        }
    });
</script>

<h1>Initializing the extension failed</h1>
<div>Something went wrong while initializing the extension.</div>
{#if $errorData}
    <ul>
        {#if $errorData.tmcError}
            <li>
                <div>
                    Failed to initialize tmc-langs: {$errorData.tmcError.error}. Stack trace: {$errorData
                        .tmcError.stack}
                </div>
                <div>
                    This error may be caused by a proxy or firewall that is blocking network
                    requests or by an antivirus program. This may also be caused by an antivirus
                    program. You can try to resolve this issue by adding an exception to the
                    directory at '{$errorData.cliFolder}'.
                </div>
            </li>
        {/if}
        {#if $errorData.userDataError}
            <li>
                Failed to initialize userdata: {$errorData.userDataError.error}. Stack trace: {$errorData
                    .userDataError.stack}
            </li>
        {/if}
        {#if $errorData.workspaceManagerError}
            <li>
                Failed to initialize workspace manager: {$errorData.workspaceManagerError.error}.
                Stack trace: {$errorData.workspaceManagerError.stack}
            </li>
        {/if}
        {#if $errorData.exerciseDecorationProviderError}
            <li>
                Failed to initialize exercise decoration provider: {$errorData
                    .exerciseDecorationProviderError.error}. Stack trace: {$errorData
                    .exerciseDecorationProviderError.stack}
            </li>
        {/if}
        {#if $errorData.resourcesError}
            <li>
                Failed to initialize resources: {$errorData.resourcesError.error}. Stack trace: {$errorData
                    .resourcesError.stack}
            </li>
        {/if}
        {#if !($errorData.tmcError || $errorData.userDataError || $errorData.userDataError || $errorData.userDataError || $errorData.userDataError)}
            <div>No error data found</div>
        {/if}
    </ul>
{:else}
    <div>Loading error data...</div>
{/if}
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
