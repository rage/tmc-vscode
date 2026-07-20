<script lang="ts">
  import { onMount } from "svelte"

  import CourseDetails from "./panels/CourseDetails.svelte"
  import ExerciseSubmission from "./panels/ExerciseSubmission.svelte"
  import ExerciseTests from "./panels/ExerciseTests.svelte"
  import InitializationErrorHelp from "./panels/InitializationErrorHelp.svelte"
  import Login from "./panels/Login.svelte"
  import MyCourses from "./panels/MyCourses.svelte"
  import SelectCourse from "./panels/SelectCourse.svelte"
  import SelectMoocCourse from "./panels/SelectMoocCourse.svelte"
  import SelectOrganization from "./panels/SelectOrganization.svelte"
  // registers the custom elements used by the webview (import side effect)
  import "@vscode-elements/elements/dist/vscode-badge/index.js"
  import "@vscode-elements/elements/dist/vscode-button/index.js"
  import "@vscode-elements/elements/dist/vscode-checkbox/index.js"
  import "@vscode-elements/elements/dist/vscode-divider/index.js"
  import "@vscode-elements/elements/dist/vscode-label/index.js"
  import "@vscode-elements/elements/dist/vscode-progress-ring/index.js"
  import "@vscode-elements/elements/dist/vscode-textfield/index.js"

  import SelectPlatform from "./panels/SelectPlatform.svelte"
  import Welcome from "./panels/Welcome.svelte"
  import type { State, AppPanel, Panel } from "./shared/shared"
  import { assertUnreachable } from "./shared/shared"
  import { addMessageListener } from "./utilities/script"
  import { vscode } from "./utilities/vscode"

  onMount(() => {
    // we shouldn't have any uncaught errors, but if they happen, this will show the user a simple error message
    // without this, the result is just a blank page
    window.addEventListener("error", (ev) => {
      console.error("Uncaught error", ev)
      document.body.innerHTML = `
<div>Uncaught error: ${ev.message}</div>
<div>This is a bug in the extension.</div>
<div>Stack trace:<div>
<pre>
${ev.error.stack}
</pre>
`
    })
    window.onunhandledrejection = (ev) => {
      console.error("Unhandled rejection", ev)
      document.body.innerHTML = `
<div>Unhandled rejection: ${ev.reason.message}</div>
<div>This is a bug in the extension.</div>
<div>Stack trace:<div>
<pre>
${ev.reason.stack}
</pre>
`
    }
  })

  const appPanel: AppPanel = {
    id: 0,
    type: "App",
  }
  const initialState = vscode.getState() ?? {
    panel: appPanel,
  }

  // $state.raw: the state is only ever replaced wholesale, and the panel
  // object is passed to vscode.postMessage by the panel components —
  // a deep $state proxy would fail postMessage's structured clone
  let appState = $state.raw<State>(initialState)
  addMessageListener(appPanel, (message) => {
    switch (message.type) {
      case "setPanel": {
        const newState = { panel: message.panel }
        if (!isTransient(newState.panel)) {
          vscode.setState(newState)
        }
        console.log(newState)
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
      panel.type === "ExerciseSubmission"
    )
  }
</script>

<main>
  <div class="container">
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
      {:else if appState.panel.type === "InitializationErrorHelp"}
        <InitializationErrorHelp panel={appState.panel} />
      {:else if appState.panel.type === "App"}
        <div>Loading TestMyCode...</div>
      {:else}
        {assertUnreachable(appState.panel)}
      {/if}
    {/key}
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
