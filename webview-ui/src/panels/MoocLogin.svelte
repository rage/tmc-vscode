<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import type { MoocLoginPanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: MoocLoginPanel
  }

  let { panel }: Props = $props()

  interface DeviceCode {
    userCode: string
    verificationUri: string
    verificationUriComplete: string | null
  }

  // "awaiting": device code is shown, waiting for the user to approve in the browser.
  let status = $state<"starting" | "awaiting" | "error" | "cancelled">("starting")
  let device = $state<DeviceCode | null>(null)
  let errorMessage = $state<string | null>(null)
  let copied = $state(false)

  function startLogin() {
    status = "starting"
    device = null
    errorMessage = null
    copied = false
    vscode.postMessage({
      type: "moocLogin",
      sourcePanel: panel,
    })
  }

  onMount(startLogin)

  // svelte-ignore state_referenced_locally -- panel id/type is fixed for the component's lifetime
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "moocDeviceCode": {
        // A device code in flight when the user cancelled must not resurrect the "awaiting" state.
        if (status !== "cancelled") {
          device = {
            userCode: message.userCode,
            verificationUri: message.verificationUri,
            verificationUriComplete: message.verificationUriComplete,
          }
          status = "awaiting"
        }
        break
      }
      case "moocLoginError": {
        // A cancel already killed the process; keep the cancelled state rather
        // than overwriting it with the resulting "process was killed" error.
        if (status !== "cancelled") {
          errorMessage = message.error
          status = "error"
        }
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function openInBrowser() {
    const dev = device
    if (!dev) {
      return
    }
    vscode.postMessage({
      type: "openLinkInBrowser",
      url: dev.verificationUriComplete ?? dev.verificationUri,
    })
  }

  async function copyUserCode() {
    const dev = device
    if (!dev) {
      return
    }
    // Only claim "Copied" if the write actually succeeded; the Clipboard API can be
    // absent (insecure context / older webview) or reject (permission denied).
    const clipboard = navigator.clipboard
    if (!clipboard) {
      copied = false
      return
    }
    try {
      await clipboard.writeText(dev.userCode)
      copied = true
    } catch {
      copied = false
    }
  }

  function cancel() {
    status = "cancelled"
    // Post only the panel identity: `cancelMoocLogin`'s strict target schema rejects extra keys.
    vscode.postMessage({
      type: "cancelMoocLogin",
      sourcePanel: { id: panel.id, type: panel.type },
    })
  }
</script>

<div class="mooc-login">
  <h1>Log in to courses.mooc.fi</h1>

  {#if status === "error"}
    <div class="error" role="alert">
      Login failed: {errorMessage ?? "the login was denied or expired."}
    </div>
    <Button class="button" onclick={startLogin}>Try again</Button>
  {:else if status === "cancelled"}
    <div role="status">Login cancelled.</div>
    <Button class="button" onclick={startLogin}>Try again</Button>
  {:else if status === "awaiting" && device}
    <!-- Announced politely and atomically the moment the device code appears. -->
    <div role="status">
      <p>
        To sign in, open the verification page and enter this code. Keep this panel open — it
        continues automatically once you approve.
      </p>

      <div
        class="user-code"
        role="button"
        tabindex="0"
        title="Click to copy"
        onclick={copyUserCode}
        onkeypress={copyUserCode}
      >
        {device.userCode}
      </div>
      {#if copied}
        <div class="copied">Copied to clipboard</div>
      {/if}
    </div>

    <div class="actions">
      <Button class="button" onclick={openInBrowser}>Open in browser</Button>
      <Button class="button" onclick={cancel}>Cancel</Button>
    </div>

    <div class="waiting" role="status">
      <vscode-progress-ring aria-label="Waiting for approval"></vscode-progress-ring>
      <span>Waiting for approval…</span>
    </div>
  {:else}
    <div class="waiting" role="status">
      <vscode-progress-ring aria-label="Starting login"></vscode-progress-ring>
      <span>Starting login…</span>
    </div>
    <Button class="button" onclick={cancel}>Cancel</Button>
  {/if}
</div>

<style>
  .error {
    color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
    margin-bottom: 0.5rem;
  }
  .user-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 2rem;
    letter-spacing: 0.25rem;
    font-weight: bold;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border: 1px solid var(--vscode-focusBorder, #007fd4);
    border-radius: 4px;
    display: inline-block;
    cursor: pointer;
    user-select: all;
  }
  .copied {
    opacity: 80%;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin: 0.75rem 0;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  /* buttons render as <vscode-button> inside the Button wrapper, so style through :global */
  .mooc-login :global(.button) {
    margin-top: 0.5rem;
  }
</style>
