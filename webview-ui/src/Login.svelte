<script lang="ts">
    import { writable } from "svelte/store";
    import { vscode } from "./utilities/vscode";
    import { MessageToWebview } from "./shared";
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeTextField,
    } from "@vscode/webview-ui-toolkit";

    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTextField());

    let usernameField: HTMLInputElement;
    let passwordField: HTMLInputElement;
    const error = writable<string>("");
    const buttonDisabled = writable(false);

    function onSubmit(event) {
        event.preventDefault();

        console.log(event);
        const username = usernameField.value;
        const password = passwordField.value;
        buttonDisabled.set(true);
        vscode.postMessage({
            type: "login",
            username,
            password,
        });
    }

    window.addEventListener("message", function (event) {
        for (let i = 0; i < event.data.length; i++) {
            const message = event.data[i] as MessageToWebview;
            switch (message.type) {
                case "loginError": {
                    buttonDisabled.set(false);
                    error.set(message.error);
                    setTimeout(() => {
                        error.set(null);
                    }, 7500);
                    break;
                }
                default:
                    console.trace("Unsupported command for Login", message.type);
            }
        }
    });
</script>

<div class="container fluid">
    <div class="row">
        <div class="col-md-6">
            <h1>Login to TMC</h1>
            {#if $error}
                <div>
                    <div role="alert">
                        {$error}
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
                <vscode-button type="submit" name="submit" id="submit" disabled={$buttonDisabled}>
                    Submit
                </vscode-button>
            </form>
        </div>
    </div>
</div>
