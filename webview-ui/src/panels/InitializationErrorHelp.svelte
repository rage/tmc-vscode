<script lang="ts">
  import { onMount } from "svelte"

  import type { InitializationErrorHelpPanel, RunnableCommand } from "../../../shared/lib"
  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import { restoreScroll } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: InitializationErrorHelpPanel
  }

  let { panel }: Props = $props()

  onMount(restoreScroll)

  function runCommand(command: RunnableCommand) {
    vscode.postMessage({ type: "runCommand", command })
  }
</script>

<PanelHeader title="Initializing the extension failed" />
<p>Something went wrong while initializing the extension.</p>

<h2>What failed</h2>
{#if panel.failures.length === 0}
  <p>No error data found</p>
{:else}
  <ul class="failures">
    {#each panel.failures as failure (failure.service)}
      <li>
        <p>Failed to initialize {failure.service}: {failure.error}</p>
        {#if failure.hint}<p>{failure.hint}</p>{/if}
        <Disclosure
          title="Stack trace of {failure.service}"
          headingLevel={3}
          persistAs="stackTrace:{failure.service}"
        >
          <CodeBlock label="Stack trace of {failure.service}" code={failure.stack} />
        </Disclosure>
      </li>
    {/each}
  </ul>
{/if}

<h2>What you can try</h2>
<p>
  Restarting the extension host initializes the extension again. For more detail in the logs, set
  <code>testMyCode.logLevel</code> to <code>verbose</code> first.
</p>
<div class="actions">
  <Button onclick={() => runCommand("workbench.action.restartExtensionHost")}>
    Restart Extension Host
  </Button>
  <Button secondary onclick={() => runCommand("tmc.logs")}>Show Logs</Button>
  <Button secondary onclick={() => runCommand("workbench.action.openSettings")}>
    Open Log Level Setting
  </Button>
  <Button secondary onclick={() => runCommand("workbench.action.openIssueReporter")}>
    Report an Issue
  </Button>
</div>

<style>
  .failures {
    padding-left: var(--tmc-space-4);
  }
</style>
