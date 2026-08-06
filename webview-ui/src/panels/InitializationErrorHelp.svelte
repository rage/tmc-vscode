<script lang="ts">
  import { onMount } from "svelte"

  import type { InitializationErrorHelpPanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: InitializationErrorHelpPanel
  }

  let { panel }: Props = $props()

  type ErrorData = {
    cliFolder: string
    tmcError: { error: string; stack: string } | null
    userDataError: { error: string; stack: string } | null
    workspaceManagerError: { error: string; stack: string } | null
    exerciseDecorationProviderError: { error: string; stack: string } | null
    resourcesError: { error: string; stack: string } | null
  }
  let errorData = $state<ErrorData | undefined>(undefined)

  onMount(() => {
    vscode.postMessage({
      type: "requestInitializationErrors",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "initializationErrors": {
        errorData = {
          cliFolder: message.cliFolder,
          tmcError: message.initializationErrors.tmc,
          userDataError: message.initializationErrors.userData,
          workspaceManagerError: message.initializationErrors.workspaceManager,
          exerciseDecorationProviderError: message.initializationErrors.exerciseDecorationProvider,
          resourcesError: message.initializationErrors.resources,
        }
        break
      }
      default:
        assertUnreachable(message.type)
    }
  })
</script>

{#snippet stackTrace(stack: string)}
  <vscode-collapsible heading="Stack trace" class="stack-collapsible">
    <pre class="stack">{stack}</pre>
  </vscode-collapsible>
{/snippet}

<h1>Initializing the extension failed</h1>
<div>Something went wrong while initializing the extension.</div>
{#if errorData}
  <ul>
    {#if errorData.tmcError}
      <li>
        <div>Failed to initialize tmc-langs: {errorData.tmcError.error}</div>
        <div>
          This error may be caused by a proxy or firewall that is blocking network requests or by an
          antivirus program. You can try to resolve this issue by adding an exception to the
          directory at '{errorData.cliFolder}'.
        </div>
        {@render stackTrace(errorData.tmcError.stack)}
      </li>
    {/if}
    {#if errorData.userDataError}
      <li>
        <div>Failed to initialize userdata: {errorData.userDataError.error}</div>
        {@render stackTrace(errorData.userDataError.stack)}
      </li>
    {/if}
    {#if errorData.workspaceManagerError}
      <li>
        <div>Failed to initialize workspace manager: {errorData.workspaceManagerError.error}</div>
        {@render stackTrace(errorData.workspaceManagerError.stack)}
      </li>
    {/if}
    {#if errorData.exerciseDecorationProviderError}
      <li>
        <div>
          Failed to initialize exercise decoration provider: {errorData
            .exerciseDecorationProviderError.error}
        </div>
        {@render stackTrace(errorData.exerciseDecorationProviderError.stack)}
      </li>
    {/if}
    {#if errorData.resourcesError}
      <li>
        <div>Failed to initialize resources: {errorData.resourcesError.error}</div>
        {@render stackTrace(errorData.resourcesError.stack)}
      </li>
    {/if}
    {#if !(errorData.tmcError || errorData.userDataError || errorData.workspaceManagerError || errorData.exerciseDecorationProviderError || errorData.resourcesError)}
      <div>No error data found</div>
    {/if}
  </ul>
{:else}
  <div>Loading error data…</div>
{/if}
<div>
  You can try to reinitialize the extension by pressing "Restart extension host" in the extension
  menu.
</div>
<div>
  You can also look at the logs by pressing "Open TMC Extension Logs" in the menu for more
  information about what went wrong. You can increase the log level in the Settings to `verbose` to
  see more log messages.
</div>
<div>
  If you cannot solve this issue, please create an issue at
  <a href="https://github.com/rage/tmc-vscode">https://github.com/rage/tmc-vscode</a>.
</div>

<style>
  .stack {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0.4rem;
  }
  .stack-collapsible {
    display: block;
    margin: 0.4rem 0;
  }
</style>
