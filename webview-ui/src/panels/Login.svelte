<script lang="ts">
  import { onMount } from "svelte"
  import { writable } from "svelte/store"

  import type { LoginPanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: LoginPanel
  }

  let { panel }: Props = $props()

  // the vscode-textfield elements; typed structurally by the part we use
  let usernameField: { value: string } | undefined = $state()
  let passwordField: { value: string } | undefined = $state()
  const errorTimeout = writable<NodeJS.Timeout | null>(null)
  const errorMessage = writable<string | null>(null)
  const loggingIn = writable(false)

  onMount(() => {
    vscode.postMessage({
      type: "requestLoginData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "loginError": {
        loggingIn.set(false)
        errorMessage.set(message.error)
        errorTimeout.update((val) => {
          if (val !== null) {
            clearTimeout(val)
          }
          return setTimeout(() => {
            errorMessage.set(null)
          }, 7500)
        })
        break
      }
      default:
        assertUnreachable(message.type)
    }
  })

  function onSubmit(event: Event) {
    event.preventDefault()
    loggingIn.set(true)
    const username = usernameField?.value ?? ""
    const password = passwordField?.value ?? ""
    vscode.postMessage({
      type: "login",
      username,
      password,
      sourcePanel: panel,
    })
  }
</script>

<h1>Log in</h1>

<div>
  This extension uses mooc.fi accounts. If you have previously done mooc.fi -courses, you can log in
  with your existing account.
</div>
<br />

{#if $errorMessage}
  <div class="error" role="alert">
    {$errorMessage}
  </div>
  <br />
{/if}

<form onsubmit={onSubmit}>
  <div>
    <vscode-label for="username-field">Email or username:</vscode-label>
    <vscode-textfield id="username-field" class="input" type="text" bind:this={usernameField}
    ></vscode-textfield>
    <vscode-label for="password-field">Password:</vscode-label>
    <vscode-textfield id="password-field" class="input" type="password" bind:this={passwordField}
    ></vscode-textfield>
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
