<script lang="ts">
    import { writable } from "svelte/store";
    import { vscode } from "./utilities/vscode";
    import { addMessageListener } from "./utilities/script";
    import { LoginPanel, assertUnreachable } from "./shared/shared";

    export let panel: LoginPanel;

    let usernameField: HTMLInputElement;
    let passwordField: HTMLInputElement;
    const errorMessage = writable<string | null>(null);
    const loggingIn = writable(false);

    function onSubmit(event: Event) {
        event.preventDefault();
        loggingIn.set(true);
        const username = usernameField.value;
        const password = passwordField.value;
        vscode.postMessage({
            type: "login",
            username,
            password,
            sourcePanel: panel,
        });
    }

    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "loginError": {
                loggingIn.set(false);
                errorMessage.set(message.error);
                setTimeout(() => {
                    errorMessage.set(null);
                }, 7500);
                break;
            }
            default:
                assertUnreachable(message.type);
        }
    });
</script>

<h1>Log in</h1>

<div>
    This extension uses mooc.fi accounts. If you have previously done mooc.fi -courses, you can log
    in with your existing account.
</div>
<br />

{#if $errorMessage}
    <div class="error" role="alert">
        {$errorMessage}
    </div>
    <br />
{/if}

<form on:submit={onSubmit}>
    <div>
        <vscode-text-field type="text" id="username" name="username" bind:this={usernameField}>
            Email or username:
        </vscode-text-field>
        <br />
        <vscode-text-field type="password" id="password" name="password" bind:this={passwordField}>
            Password:
        </vscode-text-field>
    </div>
    <vscode-button
        style="color: pink"
        type="submit"
        name="submit"
        id="submit"
        disabled={$loggingIn}
    >
        Log in
    </vscode-button>
</form>

<style>
    .error {
        color: var(--vscode-notebookStatusErrorIcon-foreground);
    }
</style>
