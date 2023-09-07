<script lang="ts">
    import { readable } from "svelte/store";
    import MyCourses from "./MyCourses.svelte";
    import Welcome from "./Welcome.svelte";
    import { vscode } from "./utilities/vscode";
    import { State, MessageToWebview } from "./shared";
    import Login from "./Login.svelte";
    import CourseDetails from "./CourseDetails.svelte";
    import { addMessageListener } from "./utilities/script";

    const initialState = vscode.getState() ?? {
        panel: { type: "Initial" },
    };

    export let state = readable<State>(initialState, (set) => {
        addMessageListener((message) => {
            switch (message.type) {
                case "setPanel": {
                    const newState = vscode.setState({ panel: message.panel });
                    set(newState);
                    break;
                }
                default:
                    console.trace("Unsupported command for App", message.type);
            }
        });
    });
    state.subscribe((state) => {
        console.log("New state", state);
    });
</script>

<main>
    {#if $state.panel.type === "Welcome"}
        <Welcome />
    {:else if $state.panel.type === "Login"}
        <Login />
    {:else if $state.panel.type === "MyCourses"}
        <MyCourses />
    {:else if $state.panel.type === "CourseDetails"}
        <CourseDetails courseId={$state.panel.courseId} />
    {:else if $state.panel.type === "Initial"}
        <!-- waiting for setPanel message -->
    {/if}
</main>
