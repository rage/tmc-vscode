<script lang="ts">
    import { writable } from "svelte/store";
    import { vscode } from "./utilities/vscode";
    import { addExtensionMessageListener } from "./utilities/script";
    import { LoginPanel, assertUnreachable } from "./shared";

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
        });
    }

    addExtensionMessageListener(panel, (message) => {
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
                assertUnreachable(message);
        }
    });
</script>

<div class="container">
    <div>
        <div>
            <h1>Login to TMC</h1>
            {#if $errorMessage}
                <div>
                    <div role="alert">
                        {$errorMessage}
                    </div>
                </div>
            {/if}
            <form on:submit={onSubmit}>
                <div>
                    <vscode-text-field
                        type="text"
                        id="username"
                        name="username"
                        bind:this={usernameField}
                    >
                        Email or username:
                    </vscode-text-field>
                    <vscode-text-field
                        type="password"
                        id="password"
                        name="password"
                        bind:this={passwordField}
                    >
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
                    Submit
                </vscode-button>
            </form>
        </div>
    </div>
</div>

<style>
    div {
        color: red;
    }
</style>
