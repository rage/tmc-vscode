<script lang="ts">
    import { writable } from "svelte/store";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener } from "../utilities/script";
    import { LoginPanel, assertUnreachable } from "../shared/shared";
    import { onMount } from "svelte";

    export let panel: LoginPanel;

    let usernameField: HTMLInputElement;
    let passwordField: HTMLInputElement;
    const errorTimeout = writable<NodeJS.Timeout | null>(null);
    const errorMessage = writable<string | null>(null);
    const loggingIn = writable(false);

    onMount(() => {
        vscode.postMessage({
            type: "requestLoginData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "loginError": {
                loggingIn.set(false);
                errorMessage.set(message.error);
                errorTimeout.update((val) => {
                    if (val !== null) {
                        clearTimeout(val);
                    }
                    return setTimeout(() => {
                        errorMessage.set(null);
                    }, 7500);
                });
                break;
            }
            default:
                assertUnreachable(message.type);
        }
    });

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
        <vscode-text-field class="input" type="text" bind:this={usernameField}>
            Email or username:
        </vscode-text-field>
        <br />
        <vscode-text-field class="input" type="password" bind:this={passwordField}>
            Password:
        </vscode-text-field>
    </div>
    <vscode-button role="button" tabindex="0" class="button" type="submit" disabled={$loggingIn}>
        Log in
    </vscode-button>
</form>

<style>
    .error {
        color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
    }
    .input {
        width: 100%;
        margin-bottom: 0.5rem;
    }
    .button {
        margin-top: 0.5rem;
    }
</style>
