<script lang="ts">
  import CourseDetails from "./panels/CourseDetails.svelte"
  import ExerciseSubmission from "./panels/ExerciseSubmission.svelte"
  import ExerciseTests from "./panels/ExerciseTests.svelte"
  import InitializationErrorHelp from "./panels/InitializationErrorHelp.svelte"
  import Login from "./panels/Login.svelte"
  import MoocLogin from "./panels/MoocLogin.svelte"
  import MyCourses from "./panels/MyCourses.svelte"
  import SelectCourse from "./panels/SelectCourse.svelte"
  import SelectMoocCourse from "./panels/SelectMoocCourse.svelte"
  import SelectOrganization from "./panels/SelectOrganization.svelte"
  // registers the custom elements used by the webview (import side effect)
  import "@vscode-elements/elements/dist/vscode-badge/index.js"
  import "@vscode-elements/elements/dist/vscode-button/index.js"
  import "@vscode-elements/elements/dist/vscode-button-group/index.js"
  import "@vscode-elements/elements/dist/vscode-checkbox/index.js"
  import "@vscode-elements/elements/dist/vscode-collapsible/index.js"
  import "@vscode-elements/elements/dist/vscode-divider/index.js"
  import "@vscode-elements/elements/dist/vscode-form-group/index.js"
  import "@vscode-elements/elements/dist/vscode-form-helper/index.js"
  import "@vscode-elements/elements/dist/vscode-icon/index.js"
  import "@vscode-elements/elements/dist/vscode-label/index.js"
  import "@vscode-elements/elements/dist/vscode-progress-ring/index.js"
  import "@vscode-elements/elements/dist/vscode-table/index.js"
  import "@vscode-elements/elements/dist/vscode-table-body/index.js"
  import "@vscode-elements/elements/dist/vscode-table-cell/index.js"
  import "@vscode-elements/elements/dist/vscode-table-header/index.js"
  import "@vscode-elements/elements/dist/vscode-table-header-cell/index.js"
  import "@vscode-elements/elements/dist/vscode-table-row/index.js"
  import "@vscode-elements/elements/dist/vscode-textfield/index.js"

  import SelectPlatform from "./panels/SelectPlatform.svelte"
  import Welcome from "./panels/Welcome.svelte"
  import type { State, AppPanel, Panel } from "./shared/shared"
  import { assertUnreachable } from "./shared/shared"
  import { addMessageListener } from "./utilities/script"
  import { vscode } from "./utilities/vscode"

  // Shows the user a message instead of a blank page on an uncaught error. `<svelte:boundary>`
  // below additionally catches errors thrown while a panel renders, which window handlers miss.
  let crash = $state<{ title: string; message: string; stack: string | undefined } | null>(null)

  // "ResizeObserver loop completed/limit exceeded" is a benign browser notice (deferred resize
  // callbacks), not a real error, but surfaces as a global `error` event. Responsive
  // `@vscode-elements` (e.g. `vscode-table`) trigger it during layout, so ignore it rather than
  // crashing the whole panel.
  function isBenignError(message: string): boolean {
    return message.includes("ResizeObserver loop")
  }

  function handleError(event: Event) {
    const { message, error } = event as ErrorEvent
    if (isBenignError(message)) {
      return
    }
    console.error("Uncaught error", event)
    crash = {
      title: "Uncaught error",
      message,
      stack: (error as Error | undefined)?.stack,
    }
  }
  function handleRejection(event: Event) {
    console.error("Unhandled rejection", event)
    const reason = (event as PromiseRejectionEvent).reason
    crash = {
      title: "Unhandled rejection",
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    }
  }

  const appPanel: AppPanel = {
    id: 0,
    type: "App",
  }
  const initialState = vscode.getState() ?? {
    panel: appPanel,
  }

  // $state.raw, not $state: panel objects are passed to vscode.postMessage, and a deep
  // $state proxy would fail its structured clone
  let appState = $state.raw<State>(initialState)
  addMessageListener(appPanel, (message) => {
    switch (message.type) {
      case "setPanel": {
        const newState = { panel: message.panel }
        if (!isTransient(newState.panel)) {
          vscode.setState(newState)
        }
        appState = newState
        break
      }
      default:
        return assertUnreachable(message.type)
    }
  })

  // "transient" panels which shouldn't be saved/loaded
  function isTransient(panel: Panel) {
    return (
      panel.type === "SelectCourse" ||
      panel.type === "SelectOrganization" ||
      panel.type === "ExerciseTests" ||
      panel.type === "ExerciseSubmission" ||
      panel.type === "MoocLogin"
    )
  }
</script>

{#snippet crashView(title: string, message: string, stack: string | undefined)}
  <div>{title}: {message}</div>
  <div>This is a bug in the extension.</div>
  <div>Stack trace:</div>
  <pre>{stack}</pre>
{/snippet}

<svelte:window onerror={handleError} onunhandledrejection={handleRejection} />

<main>
  <div class="container">
    {#if crash}
      {@render crashView(crash.title, crash.message, crash.stack)}
    {:else}
      <svelte:boundary>
        {#key appState.panel.id}
          {#if appState.panel.type === "Welcome"}
            <Welcome panel={appState.panel} />
          {:else if appState.panel.type === "Login"}
            <Login panel={appState.panel} />
          {:else if appState.panel.type === "MyCourses"}
            <MyCourses panel={appState.panel} />
          {:else if appState.panel.type === "CourseDetails"}
            <CourseDetails panel={appState.panel} />
          {:else if appState.panel.type === "SelectOrganization"}
            <SelectOrganization panel={appState.panel} />
          {:else if appState.panel.type === "SelectCourse"}
            <SelectCourse panel={appState.panel} />
          {:else if appState.panel.type === "ExerciseTests"}
            <ExerciseTests panel={appState.panel} />
          {:else if appState.panel.type === "ExerciseSubmission"}
            <ExerciseSubmission panel={appState.panel} />
          {:else if appState.panel.type === "SelectPlatform"}
            <SelectPlatform panel={appState.panel} />
          {:else if appState.panel.type === "SelectMoocCourse"}
            <SelectMoocCourse panel={appState.panel} />
          {:else if appState.panel.type === "MoocLogin"}
            <MoocLogin panel={appState.panel} />
          {:else if appState.panel.type === "InitializationErrorHelp"}
            <InitializationErrorHelp panel={appState.panel} />
          {:else if appState.panel.type === "App"}
            <div>Loading TestMyCode…</div>
          {:else}
            {assertUnreachable(appState.panel)}
          {/if}
        {/key}

        {#snippet failed(error: unknown)}
          {@render crashView(
            "Uncaught error",
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error.stack : undefined,
          )}
        {/snippet}
      </svelte:boundary>
    {/if}
  </div>
</main>

<style>
  .container {
    /*
            locks the side margins to be at most 20vw,
            gradually decreasing to zero as the viewport becomes more narrow
        */
    margin: 0rem min(20vw, max(0vw, calc(40vw - 20rem)));
  }
</style>
