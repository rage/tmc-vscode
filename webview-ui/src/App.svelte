<script lang="ts">
    import { writable } from "svelte/store";
    import MyCourses from "./MyCourses.svelte";
    import Welcome from "./Welcome.svelte";
    import { vscode } from "./utilities/vscode";
    import { State, assertUnreachable, AppPanel } from "./shared/shared";
    import Login from "./Login.svelte";
    import CourseDetails from "./CourseDetails.svelte";
    import SelectOrganization from "./SelectOrganization.svelte";
    import SelectCourse from "./SelectCourse.svelte";
    import { addMessageListener } from "./utilities/script";
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeTextField,
        vsCodeCheckbox,
        vsCodeProgressRing,
        vsCodeTag,
    } from "@vscode/webview-ui-toolkit";
    import ExerciseTests from "./ExerciseTests.svelte";
    import ExerciseSubmission from "./ExerciseSubmission.svelte";
    import { onMount } from "svelte";

    onMount(() => {
        // we shouldn't have any uncaught errors, but if they happen, this will show the user a simple error message
        // without this, the result is just a blank page
        window.addEventListener("error", (ev) => {
            console.error("Uncaught error", ev);
            document.body.innerHTML = `
<div>Uncaught error: ${ev.message}</div>
<div>This is a bug in the extension.</div>
<div>Stack trace:<div>
<pre>
${ev.error.stack}
</pre>
`;
        });
        window.onunhandledrejection = (ev) => {
            console.error("Unhandled rejection", ev);
            document.body.innerHTML = `
<div>Unhandled rejection: ${ev.reason.message}</div>
<div>This is a bug in the extension.</div>
<div>Stack trace:<div>
<pre>
${ev.reason.stack}
</pre>
`;
        };
    });

    // here, we register all of the components from VSCode's toolkit that we use
    provideVSCodeDesignSystem().register(
        vsCodeButton(),
        vsCodeTextField(),
        vsCodeCheckbox(),
        vsCodeProgressRing(),
        vsCodeTag(),
    );

    const appPanel: AppPanel = {
        id: 0,
        type: "App",
    };
    const initialState = vscode.getState() ?? {
        panel: appPanel,
    };

    const state = writable<State>(initialState, (set) => {
        addMessageListener(appPanel, (message) => {
            switch (message.type) {
                case "setPanel": {
                    console.log("new state, setting in vscode");
                    const newState = vscode.setState({ panel: message.panel });
                    console.log("new state, setting");
                    set(newState);
                    break;
                }
                default:
                    return assertUnreachable(message.type);
            }
        });
        return () => {};
    });
    // need at least one subscriber to add the message listener
    state.subscribe((ev) => {
        console.log(ev);
    });
</script>

<main>
    <div class="container">
        {#key $state.panel.id}
            {#if $state.panel.type === "Welcome"}
                <Welcome panel={$state.panel} />
            {:else if $state.panel.type === "Login"}
                <Login panel={$state.panel} />
            {:else if $state.panel.type === "MyCourses"}
                <MyCourses panel={$state.panel} />
            {:else if $state.panel.type === "CourseDetails"}
                <CourseDetails panel={$state.panel} />
            {:else if $state.panel.type === "SelectOrganization"}
                <SelectOrganization panel={$state.panel} />
            {:else if $state.panel.type === "SelectCourse"}
                <SelectCourse panel={$state.panel} />
            {:else if $state.panel.type === "ExerciseTests"}
                <ExerciseTests panel={$state.panel} />
            {:else if $state.panel.type === "ExerciseSubmission"}
                <ExerciseSubmission panel={$state.panel} />
            {:else if $state.panel.type === "App"}
                <div>Loading TestMyCode...</div>
            {:else}
                {assertUnreachable($state.panel)}
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
