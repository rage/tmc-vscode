<script lang="ts">
  import { onMount } from "svelte"

  import type { InitializationErrorHelpPanel, RunnableCommand } from "../../../shared/lib"
  import ActionBar from "../components/ActionBar.svelte"
  import ActionMenu from "../components/ActionMenu.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Section from "../components/Section.svelte"
  import StatusBanner from "../components/StatusBanner.svelte"
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

<PanelHeader title="TestMyCode Help">
  {#snippet toolbar()}
    <ActionMenu
      actions={[
        {
          label: "Open Log Level Setting",
          onselect: () => runCommand("workbench.action.openSettings"),
        },
      ]}
    />
  {/snippet}
</PanelHeader>

<StatusBanner tone="failed" title="Initializing the extension failed">
  <p>Courses and exercises are unavailable until TestMyCode starts.</p>
</StatusBanner>

<ActionBar
  primary={{
    label: "Restart Extension Host",
    onclick: () => runCommand("workbench.action.restartExtensionHost"),
  }}
  secondary={[
    { label: "Show Logs", onclick: () => runCommand("tmc.logs") },
    { label: "Report an Issue", onclick: () => runCommand("workbench.action.openIssueReporter") },
  ]}
/>

<Section title="What failed">
  {#if panel.failures.length === 0}
    <p class="muted">No error data found</p>
  {:else}
    <ul class="failures">
      {#each panel.failures as failure (failure.service)}
        <li>
          <p>Failed to initialize {failure.service}: {failure.error}</p>
          {#if failure.hint}<p class="muted">{failure.hint}</p>{/if}
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
</Section>

<Section title="What you can try">
  <p>
    Restarting the extension host initializes the extension again. For more detail in the logs, set
    <code>testMyCode.logLevel</code> to <code>verbose</code> first.
  </p>
</Section>

<style>
  .failures {
    list-style: none;
    padding: 0;
  }
  .failures > li + li {
    margin-top: var(--tmc-space-4);
  }
</style>
