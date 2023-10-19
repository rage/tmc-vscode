<script lang="ts">
    import { writable } from "svelte/store";
    import MyCourses from "./MyCourses.svelte";
    import Welcome from "./Welcome.svelte";
    import { vscode } from "./utilities/vscode";
    import { State, Panel, assertUnreachable } from "./shared";
    import Login from "./Login.svelte";
    import CourseDetails from "./CourseDetails.svelte";
    import SelectOrganization from "./SelectOrganization.svelte";
    import SelectCourse from "./SelectCourse.svelte";
    import { addExtensionMessageListener } from "./utilities/script";
    import {
        provideVSCodeDesignSystem,
        vsCodeButton,
        vsCodeTextField,
    } from "@vscode/webview-ui-toolkit";

    window.addEventListener("error", (ev) => {
        // we shouldn't have any uncaught errors, but if they happen, this will show the user a simple error message
        // without this, the result is just a blank page
        document.body.innerHTML = `Uncaught error: ${ev.message}`;
    });

    // here, we register all of the components from VSCode's toolkit that we use
    provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTextField());

    const appPanel: Panel = {
        id: 0,
        type: "App",
    };
    const initialState = vscode.getState() ?? {
        panel: appPanel,
    };

    const state = writable<State>(initialState, (set) => {
        addExtensionMessageListener(appPanel, (message) => {
            switch (message.type) {
                case "setPanel": {
                    console.log("new state, setting in vscode");
                    const newState = vscode.setState({ panel: message.panel });
                    console.log("new state, setting");
                    set(newState);
                    break;
                }
                default:
                    return assertUnreachable(message);
            }
        });
        return () => {};
    });
    // need at least one subscriber to add the message listener
    state.subscribe((ev) => {
        console.log(ev);
    });
</script>

<head>
    <title>TestMyCode</title>
</head>

<main>
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
        {:else if $state.panel.type === "App"}
            <div>Loading...</div>
        {/if}
    {/key}
</main>
