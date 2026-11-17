<script lang="ts">
  import { onMount, tick } from "svelte"

  import type { ErrorHelpPanel, RunnableCommand } from "../../../shared/lib"
  import type { BarAction } from "../components/ActionBar.svelte"
  import ActionBar from "../components/ActionBar.svelte"
  import type { MenuAction } from "../components/ActionMenu.svelte"
  import ActionMenu from "../components/ActionMenu.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Section from "../components/Section.svelte"
  import Spinner from "../components/Spinner.svelte"
  import StatusBanner from "../components/StatusBanner.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import { announce } from "../utilities/a11y.svelte"
  import { createRequester, HOST_STATE_TIMEOUT_MS } from "../utilities/script"
  import { restoreScroll } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ErrorHelpPanel
  }

  /** What went wrong and what to try: a failed start, one failure's details, or general help. */
  let { panel }: Props = $props()

  const request = createRequester()
  const topic = $derived(panel.topic)
  const sourcePanel = $derived({ id: panel.id, type: panel.type })

  let logTail = $state<string | undefined>(undefined)
  let isLogTailFailed = $state(false)

  async function refreshLogTail() {
    const outcome = await request(
      "requestLogTail",
      { sourcePanel },
      { timeoutMs: HOST_STATE_TIMEOUT_MS },
    )
    isLogTailFailed = !outcome.ok
    logTail = outcome.ok ? outcome.value : undefined
  }

  onMount(() => {
    void refreshLogTail().then(async () => {
      await tick()
      restoreScroll()
    })
  })

  function runCommand(command: RunnableCommand) {
    vscode.postMessage({ type: "runCommand", command })
  }

  async function copy(text: string) {
    const outcome = await request("copyToClipboard", { sourcePanel, text })
    announce(outcome.ok ? "Copied to the clipboard" : "Could not copy to the clipboard")
  }

  /** Everything the screen shows of an operation's failure, for a bug report. */
  function detailsText(): string {
    const details = topic.kind === "operation" ? topic.details : null
    return [
      ...(details ? [details.summary, `At ${details.occurredAt}`, details.causeChain] : []),
      logTail ? `Recent log:\n${logTail}` : "",
    ]
      .filter((part) => part !== "")
      .join("\n\n")
  }

  const showLogs: BarAction = { label: "Show Logs", onclick: () => runCommand("tmc.logs") }
  const reportIssue: BarAction = {
    label: "Report an Issue",
    onclick: () => runCommand("workbench.action.openIssueReporter"),
  }
  const copyDetails: BarAction = { label: "Copy Details", onclick: () => void copy(detailsText()) }

  const bar = $derived.by((): { primary?: BarAction; secondary: [] | [BarAction, BarAction] } => {
    if (topic.kind === "startup") {
      return {
        primary: {
          label: "Restart Extension Host",
          onclick: () => runCommand("workbench.action.restartExtensionHost"),
        },
        secondary: [showLogs, reportIssue],
      }
    }
    if (topic.kind === "operation" && topic.details) {
      const [remedy] = topic.details.actions
      return {
        primary: remedy
          ? { label: remedy.label, onclick: () => runCommand(remedy.command) }
          : showLogs,
        secondary: remedy ? [showLogs, copyDetails] : [copyDetails, reportIssue],
      }
    }
    return { primary: showLogs, secondary: [] }
  })

  const menuActions = $derived.by((): MenuAction[] => {
    const isReportInBar = [bar.primary, ...bar.secondary].includes(reportIssue)
    return [
      ...(isReportInBar ? [] : [{ label: reportIssue.label, onselect: reportIssue.onclick }]),
      {
        label: "Open Log Level Setting",
        onselect: () => runCommand("workbench.action.openSettings"),
      },
    ]
  })
</script>

<PanelHeader title={topic.kind === "operation" ? "Error Details" : "TestMyCode Help"}>
  {#snippet toolbar()}
    <ActionMenu actions={menuActions} />
  {/snippet}
</PanelHeader>

{#if topic.kind === "startup"}
  <StatusBanner tone="failed" title="Initializing the extension failed">
    <p>Courses and exercises are unavailable until TestMyCode starts.</p>
  </StatusBanner>
{:else if topic.kind === "operation" && topic.details}
  <StatusBanner tone="failed" title={topic.details.summary}>
    <p class="muted">
      <time datetime={topic.details.occurredAt}>
        {new Date(topic.details.occurredAt).toLocaleString()}
      </time>
    </p>
  </StatusBanner>
{:else if topic.kind === "operation"}
  <StatusBanner tone="info" title="These details are gone">
    <p>
      They were cleared when the window reloaded, or by newer failures. The log below may still show
      what happened.
    </p>
  </StatusBanner>
{:else}
  <StatusBanner tone="info" title="If the TestMyCode tools fail">
    <p>{topic.hint}</p>
  </StatusBanner>
{/if}

<ActionBar primary={bar.primary} secondary={bar.secondary} />

{#if topic.kind === "startup"}
  <Section title="What failed">
    {#if topic.failures.length === 0}
      <p class="muted">No error data found</p>
    {:else}
      <ul class="failures">
        {#each topic.failures as failure (failure.service)}
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
      Restarting the extension host initializes the extension again. For more detail in the logs,
      set
      <code>testMyCode.logLevel</code> to <code>verbose</code> first.
    </p>
  </Section>
{:else if topic.kind === "operation" && topic.details}
  <Section title="Cause">
    <CodeBlock label="Cause" code={topic.details.causeChain} oncopy={copy} />
  </Section>
{/if}

<Section title="Recent log">
  {#snippet actions()}
    <ToolbarButton icon="refresh" label="Refresh the log" onclick={() => void refreshLogTail()} />
  {/snippet}
  {#if logTail !== undefined}
    {#if logTail === ""}
      <p class="muted">Nothing has been logged yet.</p>
    {:else}
      <CodeBlock label="Recent log" code={logTail} oncopy={copy} />
    {/if}
  {:else if isLogTailFailed}
    <p class="muted">The log could not be read. Show Logs opens it.</p>
  {:else}
    <Spinner label="Reading the log…" />
  {/if}
</Section>

<style>
  .failures {
    list-style: none;
    padding: 0;
  }
  .failures > li + li {
    margin-top: var(--tmc-space-4);
  }
  /* Errors carry long unbroken paths. */
  .failures p {
    overflow-wrap: anywhere;
  }
</style>
