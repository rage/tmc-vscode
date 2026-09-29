<script lang="ts">
  import Button from "./components/Button.svelte"
  import CodeBlock from "./components/CodeBlock.svelte"
  import Notice from "./components/Notice.svelte"
  import PanelHeader from "./components/PanelHeader.svelte"
  import Spinner from "./components/Spinner.svelte"
  import CourseDetails from "./panels/CourseDetails.svelte"
  import ExerciseSubmission from "./panels/ExerciseSubmission.svelte"
  import InitializationErrorHelp from "./panels/InitializationErrorHelp.svelte"
  import MoocLogin from "./panels/MoocLogin.svelte"
  import MyCourses from "./panels/MyCourses.svelte"
  import Welcome from "./panels/Welcome.svelte"
  import type { AppPanel, Panel } from "./shared/shared"
  import { assertUnreachable } from "./shared/shared"
  import { addMessageListener } from "./utilities/script"
  import { vscode } from "./utilities/vscode"

  interface Crash {
    title: string
    message: string
    stack: string | undefined
  }

  // Window handlers catch errors outside rendering; `<svelte:boundary>` below catches the
  // ones thrown while a panel renders, which never reach them.
  let crash = $state.raw<Crash | null>(null)

  // "ResizeObserver loop completed/limit exceeded" is a benign browser notice (deferred resize
  // callbacks), not a real error, but surfaces as a global `error` event. Responsive
  // `@vscode-elements` (e.g. `vscode-table`) trigger it during layout, so ignore it rather than
  // crashing the whole panel.
  function isBenignError(message: string): boolean {
    return message.includes("ResizeObserver loop")
  }

  function reportCrash({ title, message, stack }: Crash): void {
    console.error(title, message, stack)
    vscode.postMessage({
      type: "webviewError",
      message: `${title}: ${message}`,
      ...(stack === undefined ? {} : { stack }),
    })
  }

  function toCrash(title: string, error: unknown): Crash {
    return {
      title,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
  }

  function handleError(event: Event) {
    const { message, error } = event as ErrorEvent
    if (isBenignError(message)) {
      return
    }
    crash = { ...toCrash("Uncaught error", error), message }
    reportCrash(crash)
  }
  function handleRejection(event: Event) {
    crash = toCrash("Unhandled rejection", (event as PromiseRejectionEvent).reason)
    reportCrash(crash)
  }
  function handleRenderError(error: unknown) {
    reportCrash(toCrash("Uncaught error", error))
  }

  const appPanel: AppPanel = {
    id: 0,
    type: "App",
  }
  let appState = $state.raw<{ panel: Panel }>({ panel: appPanel })
  addMessageListener(appPanel, (message) => {
    switch (message.type) {
      case "setPanel": {
        crash = null
        appState = { panel: message.panel }
        break
      }
      default:
        return assertUnreachable(message.type)
    }
  })

  // A reload loses whatever the extension already posted, so ask it to resend. Posted
  // after the listener above is registered, or the reply could arrive unheard.
  vscode.postMessage({ type: "ready" })
</script>

{#snippet crashView({ title, message, stack }: Crash, retry: () => void)}
  <PanelHeader title="TestMyCode ran into a problem" />
  <Notice kind="error" title="{title}: {message}">
    <p>This is a bug in the extension.</p>
    {#if stack}
      <CodeBlock label="Stack trace" code={stack} />
    {/if}
    {#snippet actions()}
      <Button onclick={retry}>Reload</Button>
      <Button
        secondary
        onclick={() => vscode.postMessage({ type: "runCommand", command: "tmc.logs" })}
      >
        Show logs
      </Button>
    {/snippet}
  </Notice>
{/snippet}

<svelte:window onerror={handleError} onunhandledrejection={handleRejection} />

<main>
  <div class="container">
    {#if crash}
      {@render crashView(crash, () => {
        crash = null
        // The extension answers "ready" with the panel it last rendered, so the view
        // comes back rather than sitting empty until the user navigates somewhere.
        vscode.postMessage({ type: "ready" })
      })}
    {:else}
      {#key appState.panel.id}
        <svelte:boundary onerror={handleRenderError}>
          {#if appState.panel.type === "Welcome"}
            <Welcome panel={appState.panel} />
          {:else if appState.panel.type === "MyCourses"}
            <MyCourses panel={appState.panel} />
          {:else if appState.panel.type === "CourseDetails"}
            <CourseDetails panel={appState.panel} />
          {:else if appState.panel.type === "ExerciseSubmission"}
            <ExerciseSubmission panel={appState.panel} />
          {:else if appState.panel.type === "MoocLogin"}
            <MoocLogin panel={appState.panel} />
          {:else if appState.panel.type === "InitializationErrorHelp"}
            <InitializationErrorHelp panel={appState.panel} />
          {:else if appState.panel.type === "App"}
            <Spinner label="Loading TestMyCode…" />
          {:else}
            {assertUnreachable(appState.panel)}
          {/if}

          {#snippet failed(error: unknown, reset: () => void)}
            {@render crashView(toCrash("Uncaught error", error), () => {
              // The boundary keeps rendering its fallback until `reset`; asking the
              // extension to resend the panel alone would change nothing on screen.
              reset()
              vscode.postMessage({ type: "ready" })
            })}
          {/snippet}
        </svelte:boundary>
      {/key}
    {/if}
  </div>
</main>

<style>
  :global(body) {
    /* ensures no layout shift during loading */
    scrollbar-gutter: stable;
  }

  .container {
    /* side margins of at most 20vw, shrinking to zero as the viewport narrows */
    margin: 0 min(20vw, max(0px, calc(40vw - 320px)));
  }
</style>
