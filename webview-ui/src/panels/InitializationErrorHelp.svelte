<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import type {
    InitializationErrorHelpPanel,
    TargetedExtensionToWebview,
    WebviewToExtension,
  } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: InitializationErrorHelpPanel
  }

  let { panel }: Props = $props()

  type InitializationErrors = Extract<
    TargetedExtensionToWebview<"InitializationErrorHelp">,
    { type: "initializationErrors" }
  >["initializationErrors"]
  type RunnableCommand = Extract<WebviewToExtension, { type: "runCommand" }>["command"]

  interface InitializationFailure {
    key: keyof InitializationErrors
    label: string
    error: string
    stack: string
    hint?: string | undefined
  }

  const components: ReadonlyArray<{ key: keyof InitializationErrors; label: string }> = [
    { key: "tmc", label: "tmc-langs" },
    { key: "userData", label: "user data" },
    { key: "workspaceManager", label: "workspace manager" },
    { key: "exerciseDecorationProvider", label: "exercise decoration provider" },
    { key: "resources", label: "resources" },
  ]

  let failures = $state.raw<InitializationFailure[] | undefined>(undefined)

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
        const cliHint =
          "A proxy, firewall or antivirus program blocking network requests can cause this. " +
          `Try adding an exception for the directory '${message.cliFolder}'.`
        failures = components.flatMap(({ key, label }) => {
          const failure = message.initializationErrors[key]
          return failure
            ? [{ key, label, ...failure, hint: key === "tmc" ? cliHint : undefined }]
            : []
        })
        break
      }
      default:
        assertUnreachable(message.type)
    }
  })

  function runCommand(command: RunnableCommand) {
    vscode.postMessage({ type: "runCommand", command })
  }
</script>

<PanelHeader title="Initializing the extension failed" />
<p>Something went wrong while initializing the extension.</p>

<h2>What failed</h2>
{#if failures === undefined}
  <Spinner label="Loading error data…" />
{:else if failures.length === 0}
  <p>No error data found</p>
{:else}
  <ul class="failures">
    {#each failures as failure (failure.key)}
      <li>
        <p>Failed to initialize {failure.label}: {failure.error}</p>
        {#if failure.hint}<p>{failure.hint}</p>{/if}
        <Disclosure title="Stack trace of {failure.label}" headingLevel={3}>
          <CodeBlock label="Stack trace of {failure.label}" code={failure.stack} />
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
    Restart extension host
  </Button>
  <Button secondary onclick={() => runCommand("tmc.logs")}>Show logs</Button>
  <Button secondary onclick={() => runCommand("workbench.action.openSettings")}>
    Open log level setting
  </Button>
  <Button secondary onclick={() => runCommand("workbench.action.openIssueReporter")}>
    Report an issue
  </Button>
</div>

<style>
  .failures {
    padding-left: var(--tmc-space-4);
  }
</style>
