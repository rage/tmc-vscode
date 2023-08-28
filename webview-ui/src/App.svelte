<script lang="ts">
    import { readable } from "svelte/store";
    import MyCourses from "./MyCourses.svelte";
    import Welcome from "./Welcome.svelte";
    import { vscode } from "./utilities/vscode";
    import { State, MessageToWebview } from "./shared";
    import Login from "./Login.svelte";
    import { PanelTab } from "@vscode/webview-ui-toolkit";
    import CourseDetails from "./CourseDetails.svelte";

    const initialState: State = {
        panel: { type: "Initial" },
    };

    export let state = readable<State>(vscode.getState() || initialState, (set) => {
        window.addEventListener("message", (event) => {
            const message = event.data as MessageToWebview;
            console.log("Received", message);
            switch (message.type) {
                case "setPanel": {
                    const newState = vscode.setState({ panel: message.panel });
                    set(newState);
                    break;
                }
                default:
                    console.error("Unhandled message type from extension host", message.type);
            }
        });
    });
    state.subscribe((state) => {
        console.log("New state", state);
    });
</script>

<main>
    {#if $state.panel.type === "Welcome"}
        <Welcome {...$state.panel.data} />
    {:else if $state.panel.type === "Login"}
        <Login />
    {:else if $state.panel.type === "MyCourses"}
        <MyCourses {...$state.panel.data} />
    {:else if $state.panel.type === "CourseDetails"}
        <CourseDetails {...$state.panel.data} />
    {:else if $state.panel.type === "Initial"}
        <!-- waiting for message -->
    {/if}
</main>
