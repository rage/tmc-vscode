<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import type { LoginPanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: LoginPanel
  }

  let { panel }: Props = $props()

  // collision-proof ids for the label/field associations
  const fieldId = $props.id()
  const usernameId = `${fieldId}-username`
  const passwordId = `${fieldId}-password`
  let username = $state("")
  let password = $state("")

  // vscode-textfield is a custom element, so `bind:value` doesn't apply; mirror manually.
  function readValue(event: Event): string {
    return (event.currentTarget as { value: string } | null)?.value ?? ""
  }

  let errorTimeout: NodeJS.Timeout | null = null
  let errorMessage = $state<string | null>(null)
  let loggingIn = $state(false)

  onMount(() => {
    vscode.postMessage({
      type: "requestLoginData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- panel id/type is fixed for the component's lifetime
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "loginError": {
        loggingIn = false
        errorMessage = message.error
        if (errorTimeout !== null) {
          clearTimeout(errorTimeout)
        }
        errorTimeout = setTimeout(() => {
          errorMessage = null
        }, 7500)
        break
      }
      default:
        assertUnreachable(message.type)
    }
  })

  function onSubmit(event: Event) {
    event.preventDefault()
    loggingIn = true
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

<form onsubmit={onSubmit}>
  <vscode-form-group variant="vertical">
    <vscode-label for={usernameId}>Email or username:</vscode-label>
    <vscode-textfield
      id={usernameId}
      class="input"
      type="text"
      value={username}
      oninput={(event: Event) => (username = readValue(event))}
    ></vscode-textfield>
  </vscode-form-group>
  <vscode-form-group variant="vertical">
    <vscode-label for={passwordId}>Password:</vscode-label>
    <vscode-textfield
      id={passwordId}
      class="input"
      type="password"
      value={password}
      oninput={(event: Event) => (password = readValue(event))}
    ></vscode-textfield>
  </vscode-form-group>
  {#if errorMessage}
    <vscode-form-helper class="error" role="alert">{errorMessage}</vscode-form-helper>
  {/if}
  <Button class="button" type="submit" disabled={loggingIn}>Log in</Button>
</form>

<style>
  .error {
    color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
  }
  .input {
    width: 100%;
    margin-bottom: 0.5rem;
  }
  /* the login button renders as <vscode-button> inside the Button wrapper, so style
     through :global */
  form :global(.button) {
    margin-top: 0.5rem;
  }
</style>
